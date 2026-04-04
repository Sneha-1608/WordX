"""
Pure-Python IndicProcessor for Windows compatibility.
Port of the Cython processor.pyx from IndicTransToolkit.
Provides preprocess_batch and postprocess_batch for IndicTrans2 models.
"""

import re as stdlib_re
try:
    import regex as re
except ImportError:
    import re

from queue import Queue
from typing import List

# Optional imports — graceful degradation
try:
    from indicnlp.tokenize import indic_tokenize, indic_detokenize
    from indicnlp.normalize.indic_normalize import IndicNormalizerFactory
    from indicnlp.transliterate.unicode_transliterate import UnicodeIndicTransliterator
    HAS_INDICNLP = True
except ImportError:
    HAS_INDICNLP = False

try:
    from sacremoses import MosesPunctNormalizer, MosesTokenizer, MosesDetokenizer
    HAS_SACREMOSES = True
except ImportError:
    HAS_SACREMOSES = False


class IndicProcessor:
    def __init__(self, inference=True):
        self.inference = inference

        self._flores_codes = {
            "asm_Beng": "as", "awa_Deva": "hi", "ben_Beng": "bn",
            "bho_Deva": "hi", "brx_Deva": "hi", "doi_Deva": "hi",
            "eng_Latn": "en", "gom_Deva": "kK", "gon_Deva": "hi",
            "guj_Gujr": "gu", "hin_Deva": "hi", "hne_Deva": "hi",
            "kan_Knda": "kn", "kas_Arab": "ur", "kas_Deva": "hi",
            "kha_Latn": "en", "lus_Latn": "en", "mag_Deva": "hi",
            "mai_Deva": "hi", "mal_Mlym": "ml", "mar_Deva": "mr",
            "mni_Beng": "bn", "mni_Mtei": "hi", "npi_Deva": "ne",
            "ory_Orya": "or", "pan_Guru": "pa", "san_Deva": "hi",
            "sat_Olck": "or", "snd_Arab": "ur", "snd_Deva": "hi",
            "sin_Sinh": "si", "tam_Taml": "ta", "tel_Telu": "te",
            "urd_Arab": "ur", "unr_Deva": "hi",
        }

        # Indic digit → ASCII translation table
        digits_dict = {
            "\u09e6": "0", "\u0ae6": "0", "\u0ce6": "0", "\u0966": "0",
            "\u0660": "0", "\uabf0": "0", "\u0b66": "0", "\u0a66": "0",
            "\u1c50": "0", "\u06f0": "0",
            "\u09e7": "1", "\u0ae7": "1", "\u0967": "1", "\u0ce7": "1",
            "\u06f1": "1", "\uabf1": "1", "\u0b67": "1", "\u0a67": "1",
            "\u1c51": "1", "\u0c67": "1",
            "\u09e8": "2", "\u0ae8": "2", "\u0968": "2", "\u0ce8": "2",
            "\u06f2": "2", "\uabf2": "2", "\u0b68": "2", "\u0a68": "2",
            "\u1c52": "2", "\u0c68": "2",
            "\u09e9": "3", "\u0ae9": "3", "\u0969": "3", "\u0ce9": "3",
            "\u06f3": "3", "\uabf3": "3", "\u0b69": "3", "\u0a69": "3",
            "\u1c53": "3", "\u0c69": "3",
            "\u09ea": "4", "\u0aea": "4", "\u096a": "4", "\u0cea": "4",
            "\u06f4": "4", "\uabf4": "4", "\u0b6a": "4", "\u0a6a": "4",
            "\u1c54": "4", "\u0c6a": "4",
            "\u09eb": "5", "\u0aeb": "5", "\u096b": "5", "\u0ceb": "5",
            "\u06f5": "5", "\uabf5": "5", "\u0b6b": "5", "\u0a6b": "5",
            "\u1c55": "5", "\u0c6b": "5",
            "\u09ec": "6", "\u0aec": "6", "\u096c": "6", "\u0cec": "6",
            "\u06f6": "6", "\uabf6": "6", "\u0b6c": "6", "\u0a6c": "6",
            "\u1c56": "6", "\u0c6c": "6",
            "\u09ed": "7", "\u0aed": "7", "\u096d": "7", "\u0ced": "7",
            "\u06f7": "7", "\uabf7": "7", "\u0b6d": "7", "\u0a6d": "7",
            "\u1c57": "7", "\u0c6d": "7",
            "\u09ee": "8", "\u0aee": "8", "\u096e": "8", "\u0cee": "8",
            "\u06f8": "8", "\uabf8": "8", "\u0b6e": "8", "\u0a6e": "8",
            "\u1c58": "8", "\u0c6e": "8",
            "\u09ef": "9", "\u0aef": "9", "\u096f": "9", "\u0cef": "9",
            "\u06f9": "9", "\uabf9": "9", "\u0b6f": "9", "\u0a6f": "9",
            "\u1c59": "9", "\u0c6f": "9",
        }
        self._digits_translation_table = {}
        for k, v in digits_dict.items():
            self._digits_translation_table[ord(k)] = v
        for c in range(ord('0'), ord('9') + 1):
            self._digits_translation_table[c] = chr(c)

        self._placeholder_entity_maps = Queue()

        # Moses tools
        if HAS_SACREMOSES:
            self._en_tok = MosesTokenizer(lang="en")
            self._en_normalizer = MosesPunctNormalizer()
            self._en_detok = MosesDetokenizer(lang="en")
        else:
            self._en_tok = None
            self._en_normalizer = None
            self._en_detok = None

        # Transliterator
        if HAS_INDICNLP:
            self._xliterator = UnicodeIndicTransliterator()
        else:
            self._xliterator = None

        # Precompiled patterns
        self._MULTISPACE_REGEX = re.compile(r"[ ]{2,}")
        self._DIGIT_SPACE_PERCENT = re.compile(r"(\d) %")
        self._DOUBLE_QUOT_PUNC = re.compile(r"\"([,\.]+)")
        self._DIGIT_NBSP_DIGIT = re.compile(r"(\d) (\d)")
        self._END_BRACKET_SPACE_PUNC_REGEX = re.compile(r"\) ([\.!:?;,])")

        self._URL_PATTERN = re.compile(
            r"\b(?<![\w/.])(?:(?:https?|ftp)://)?(?:(?:[\w-]+\.)+(?!\.))(?:[\w/\-?#&=%.]+)+(?!\.\w+)\b"
        )
        self._NUMERAL_PATTERN = re.compile(
            r"(~?\d+\.?\d*\s?%?\s?-?\s?~?\d+\.?\d*\s?%|~?\d+%|\d+[-\/.,:\']\d+[-\/.,:\']+\d+(?:\.\d+)?|\d+[-\/.:\']+\d+(?:\.\d+)?)"
        )
        self._EMAIL_PATTERN = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}")
        self._OTHER_PATTERN = re.compile(r"[A-Za-z0-9]*[#|@]\w+")

        self._PUNC_REPLACEMENTS = [
            (re.compile(r"\r"), ""),
            (re.compile(r"\(\s*"), "("),
            (re.compile(r"\s*\)"), ")"),
            (re.compile(r"\s:\s?"), ":"),
            (re.compile(r"\s;\s?"), ";"),
            (re.compile(r"[`\u00b4\u2018\u201a\u2019]"), "'"),
            (re.compile(r"[\u201e\u201c\u201d\u00ab\u00bb]"), '"'),
            (re.compile(r"[\u2013\u2014]"), "-"),
            (re.compile(r"\.\.\."), "..."),
            (re.compile(r" %"), "%"),
            (re.compile(r"n\u00ba "), "n\u00ba "),
            (re.compile(r" \u00baC"), " \u00baC"),
            (re.compile(r" [?!;]"), lambda m: m.group(0).strip()),
            (re.compile(r", "), ", "),
        ]

        self._INDIC_FAILURE_CASES = [
            "\u0622\u06cc \u0688\u06cc ",
            "\ua9d1\ua9e5\ua9c7\ua9d7\ua9c4",
            "\u0906\u0908\u0921\u0940",
            "\u0906\u0908 . \u0921\u0940 . ",
            "\u0906\u0908 . \u0921\u0940 .",
            "\u0906\u0908. \u0921\u0940. ",
            "\u0906\u0908. \u0921\u0940.",
            "\u0906\u092f. \u0921\u0940. ",
            "\u0906\u092f. \u0921\u0940.",
            "\u0906\u092f . \u0921\u0940 . ",
            "\u0906\u092f . \u0921\u0940 .",
            "\u0906\u0907 . \u0921\u0940 . ",
            "\u0906\u0907 . \u0921\u0940 .",
            "\u0906\u0907. \u0921\u0940. ",
            "\u0906\u0907. \u0921\u0940.",
            "\u0910\u091f\u093f",
            "\u0622\u0626\u06cc \u0688\u06cc ",
            "\u1c71\u1c6b\u1c72\u1c64 \u1c7e",
            "\u0906\u092f\u0921\u0940",
            "\u0910\u0921\u093f",
            "\u0906\u0907\u0921\u093f",
            "\u1c71\u1c6b\u1c72\u1c64",
        ]

    def _punc_norm(self, text):
        for pat, repl in self._PUNC_REPLACEMENTS:
            text = pat.sub(repl, text)
        text = self._MULTISPACE_REGEX.sub(" ", text)
        text = self._END_BRACKET_SPACE_PUNC_REGEX.sub(r")\1", text)
        text = self._DIGIT_SPACE_PERCENT.sub(r"\1%", text)
        text = self._DOUBLE_QUOT_PUNC.sub(r'\1"', text)
        text = self._DIGIT_NBSP_DIGIT.sub(r"\1.\2", text)
        return text.strip()

    def _wrap_with_placeholders(self, text):
        serial_no = 1
        placeholder_entity_map = {}
        patterns = [self._EMAIL_PATTERN, self._URL_PATTERN, self._NUMERAL_PATTERN, self._OTHER_PATTERN]

        for pattern in patterns:
            matches = set(pattern.findall(text))
            for match in matches:
                if pattern is self._URL_PATTERN and len(match.replace(".", "")) < 4:
                    continue
                if pattern is self._NUMERAL_PATTERN and len(match.replace(" ", "").replace(".", "").replace(":", "")) < 4:
                    continue

                placeholder_entity_map[f"<ID{serial_no}>"] = match
                placeholder_entity_map[f"< ID{serial_no} >"] = match
                placeholder_entity_map[f"[ID{serial_no}]"] = match
                placeholder_entity_map[f"[ ID{serial_no} ]"] = match
                placeholder_entity_map[f"[ID {serial_no}]"] = match
                placeholder_entity_map[f"<id{serial_no}>"] = match
                placeholder_entity_map[f"< id{serial_no} >"] = match
                placeholder_entity_map[f"[id{serial_no}]"] = match
                placeholder_entity_map[f"[ id{serial_no} ]"] = match

                for indic_case in self._INDIC_FAILURE_CASES:
                    placeholder_entity_map[f"<{indic_case}{serial_no}>"] = match
                    placeholder_entity_map[f"< {indic_case}{serial_no} >"] = match
                    placeholder_entity_map[f"[{indic_case}{serial_no}]"] = match
                    placeholder_entity_map[f"{indic_case}{serial_no}"] = match

                text = text.replace(match, f"<ID{serial_no}>")
                serial_no += 1

        text = re.sub(r"\s+", " ", text).replace(">/", ">").replace("]/", "]")
        self._placeholder_entity_maps.put(placeholder_entity_map)
        return text

    def _normalize(self, text):
        text = text.translate(self._digits_translation_table)
        if self.inference:
            text = self._wrap_with_placeholders(text)
        return text

    def _preprocess(self, sent, src_lang, tgt_lang, normalizer, is_target):
        iso_lang = self._flores_codes.get(src_lang, "hi")
        script_part = src_lang.split("_")[1] if "_" in src_lang else ""
        do_transliterate = True

        sent = self._punc_norm(sent)
        sent = self._normalize(sent)

        if script_part in ["Arab", "Aran", "Olck", "Mtei", "Latn"]:
            do_transliterate = False

        if iso_lang == "en":
            if self._en_normalizer and self._en_tok:
                e_norm = self._en_normalizer.normalize(sent.strip())
                e_tokens = self._en_tok.tokenize(e_norm, escape=False)
                processed_sent = " ".join(e_tokens)
            else:
                processed_sent = sent.strip()
        else:
            if HAS_INDICNLP and normalizer:
                normed = normalizer.normalize(sent.strip())
                tokens = indic_tokenize.trivial_tokenize(normed, iso_lang)
                joined = " ".join(tokens)
                if do_transliterate:
                    joined = self._xliterator.transliterate(joined, iso_lang, "hi")
                    joined = joined.replace(" \u094d ", "\u094d")
                processed_sent = joined
            else:
                processed_sent = sent.strip()

        processed_sent = processed_sent.strip()
        if not is_target:
            return f"{src_lang} {tgt_lang} {processed_sent}"
        else:
            return processed_sent

    def _postprocess(self, sent, lang, placeholder_entity_map=None):
        if isinstance(sent, (tuple, list)):
            sent = sent[0]
        if placeholder_entity_map is None:
            placeholder_entity_map = self._placeholder_entity_maps.get()

        lang_code = lang.split("_")[0]
        script_code = lang.split("_")[1] if "_" in lang else ""
        iso_lang = self._flores_codes.get(lang, "hi")

        if script_code in ["Arab", "Aran"]:
            sent = sent.replace(" \u061f", "\u061f").replace(" \u06d4", "\u06d4").replace(" \u060c", "\u060c").replace("\u066e\u06ea", "\u0620")

        if lang_code == "ory":
            sent = sent.replace("\u0af0\u0af0", "\u0b1f")

        for k, v in placeholder_entity_map.items():
            sent = sent.replace(k, v)

        if lang == "eng_Latn":
            if self._en_detok:
                return self._en_detok.detokenize(sent.split(" "))
            return sent
        else:
            if HAS_INDICNLP and self._xliterator:
                xlated = self._xliterator.transliterate(sent, "hi", iso_lang)
                return indic_detokenize.trivial_detokenize(xlated, iso_lang)
            return sent

    def preprocess_batch(self, batch: List[str], src_lang: str, tgt_lang: str = None, is_target: bool = False, visualize: bool = False):
        normalizer = None
        iso_code = self._flores_codes.get(src_lang, "hi")
        if src_lang != "eng_Latn" and HAS_INDICNLP:
            normalizer = IndicNormalizerFactory().get_normalizer(iso_code)
        return [self._preprocess(s, src_lang, tgt_lang, normalizer, is_target) for s in batch]

    def postprocess_batch(self, sents: List[str], lang: str = "hin_Deva", visualize: bool = False, num_return_sequences: int = 1):
        results = []
        num_inputs = len(sents) // num_return_sequences
        placeholder_maps = []
        for i in range(num_inputs):
            placeholder_maps.append(self._placeholder_entity_maps.get())

        for i, sent in enumerate(sents):
            map_idx = i // num_return_sequences
            current_map = placeholder_maps[map_idx]
            results.append(self._postprocess(sent, lang, current_map))

        self._placeholder_entity_maps.queue.clear()
        return results
