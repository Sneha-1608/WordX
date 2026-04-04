"""Quick test to debug the full IndicTrans2 pipeline."""
import os, sys, time
sys.path.insert(0, 'IndicTransToolkit')
from pathlib import Path

# Load env
with open('.env') as f:
    for line in f:
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip())

import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

# Load processor
import importlib.util
spec = importlib.util.spec_from_file_location('indic_processor', 'scripts/indic_processor.py')
ip_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ip_mod)
ip = ip_mod.IndicProcessor(inference=True)

hf_token = os.environ.get('HF_TOKEN')
model_name = 'ai4bharat/indictrans2-en-indic-dist-200M'

print('Loading tokenizer...')
tok = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True, token=hf_token)
print(f'Tokenizer type: {type(tok).__name__}')

print('Loading model...')
model = AutoModelForSeq2SeqLM.from_pretrained(model_name, trust_remote_code=True, token=hf_token)
model.eval()
print(f'Model type: {type(model).__name__}')

src, tgt = 'eng_Latn', 'hin_Deva'
texts = ['Hello, how are you today?']

print('\n--- Step 1: Preprocess ---')
batch = ip.preprocess_batch(texts, src_lang=src, tgt_lang=tgt)
print(f'Batch: {batch}')

print('\n--- Step 2: Tokenize ---')
inputs = tok(batch, truncation=True, padding='longest', max_length=256, return_tensors='pt', return_attention_mask=True)
print(f'Input keys: {list(inputs.keys())}')
for k, v in inputs.items():
    print(f'  {k}: {v.shape}')

print('\n--- Step 3: Generate ---')
with torch.no_grad():
    gen = model.generate(**inputs, use_cache=False, min_length=0, max_length=256, num_beams=5, num_return_sequences=1)
print(f'Generated shape: {gen.shape}')

print('\n--- Step 4: Decode ---')
try:
    with tok.as_target_tokenizer():
        decoded = tok.batch_decode(gen.detach().cpu().tolist(), skip_special_tokens=True, clean_up_tokenization_spaces=True)
except AttributeError:
    decoded = tok.batch_decode(gen.detach().cpu().tolist(), skip_special_tokens=True, clean_up_tokenization_spaces=True)
print(f'Decoded: {decoded}')

print('\n--- Step 5: Postprocess ---')
translations = ip.postprocess_batch(decoded, lang=tgt)
print(f'RESULT: {translations}')
print('\n=== SUCCESS ===')
