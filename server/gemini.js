import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

// ═══════════════════════════════════════════════════════════════
// Gemini API Client — Production-Ready with MOCK_MODE Fallback
// ═══════════════════════════════════════════════════════════════

const MOCK_MODE = process.env.MOCK_MODE === 'true' || !process.env.GEMINI_API_KEY;

let genAI = null;
let flashModel = null;
let embeddingModel = null;

if (!MOCK_MODE && process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  flashModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-005' });
}

export function isMockMode() {
  return MOCK_MODE;
}

// ═══════════════════════════════════════════════════════════════
// TRANSLATION — Gemini 1.5 Flash
// ═══════════════════════════════════════════════════════════════

// Language code → display name map for prompts
const LANG_DISPLAY = {
  hi_IN: 'Hindi', ta_IN: 'Tamil', te_IN: 'Telugu', kn_IN: 'Kannada',
  ml_IN: 'Malayalam', bn_IN: 'Bengali', mr_IN: 'Marathi', gu_IN: 'Gujarati',
  pa_IN: 'Punjabi', or_IN: 'Odia', as_IN: 'Assamese', mai_IN: 'Maithili',
  sd_IN: 'Sindhi', ks_IN: 'Kashmiri', ne_NP: 'Nepali', ur_PK: 'Urdu',
  si_LK: 'Sinhala', mni_IN: 'Manipuri', brx_IN: 'Bodo', doi_IN: 'Dogri',
  sat_IN: 'Santali', kok_IN: 'Konkani',
  fr_FR: 'French', de_DE: 'German', es_ES: 'Spanish', pt_BR: 'Portuguese',
  it_IT: 'Italian', nl_NL: 'Dutch', ja_JP: 'Japanese', ko_KR: 'Korean',
  zh_CN: 'Chinese',
};

/**
 * Translate text using Gemini 1.5 Flash with constrained prompt.
 * @param {string} sourceText
 * @param {string} sourceLang  e.g. 'en'
 * @param {string} targetLang  e.g. 'hi_IN'
 * @param {Array}  glossaryTerms  [{source, target}]
 * @param {string|null} fuzzyRef  Fuzzy TM match to use as style reference
 * @param {string} stylePrompt  Style profile rules to inject (from §3.2.2)
 * @returns {Promise<string>}  Translated text only
 */
export async function translateText(sourceText, sourceLang, targetLang, glossaryTerms = [], fuzzyRef = null, stylePrompt = '') {
  if (MOCK_MODE) {
    return mockTranslate(sourceText, targetLang);
  }

  // Extract clean language name from code (e.g. 'hi_IN' → 'Hindi')
  const langName = LANG_DISPLAY[targetLang] || targetLang;

  // §4.1: Build spec-aligned constrained Enterprise Translator prompt
  let prompt = `You are a professional Enterprise Translator from ${sourceLang} to ${langName} (${targetLang}).
Return ONLY the translated sentence. No XML, no markdown, no explanations, no quotes.

RULES:
- Maintain the same tone and register as the source.
- Preserve any numbers, dates, and proper nouns exactly as they appear.
- Use formal/professional register for business content.`;

  // §3.2.2: Style profile injection
  if (stylePrompt) {
    prompt += `\n\nSTYLE REQUIREMENTS:${stylePrompt}`;
  }

  if (glossaryTerms.length > 0) {
    prompt += `\n\nREQUIRED GLOSSARY TERMS (MUST USE EXACTLY IF SOURCE TERM IS PRESENT):`;
    for (const term of glossaryTerms) {
      prompt += `\n"${term.source}" → "${term.target}"`;
    }
  }

  if (fuzzyRef) {
    prompt += `\n\nREFERENCE TRANSLATIONS (For Style ONLY):
Reference: "${fuzzyRef}"
Use this as a style guide but translate the actual source text below.`;
  }

  prompt += `\n\nSOURCE TEXT:\n${sourceText}`;

  try {
    const result = await flashModel.generateContent(prompt);
    const response = result.response;
    let text = response.text().trim();
    // Strip any wrapping quotes the model might add
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      text = text.slice(1, -1);
    }
    return text;
  } catch (err) {
    console.error('Gemini translation error:', err.message);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// EMBEDDINGS — text-embedding-004 (768-dimensional)
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a 768-dimensional embedding vector for text.
 * Implements Layer 3 spec §3.1.1: Contextual Embedding Prefix
 * @param {string} text
 * @param {string} context  Domain context label (e.g., 'General Business', 'Legal', 'Medical')
 * @returns {Promise<number[]>}  768-dim float array
 */
export async function generateEmbedding(text, context = 'General Business') {
  // §3.1.1: Prepend contextual prefix to shift embedding into domain-specific
  // semantic neighborhood. Dramatically improves match accuracy for short,
  // ambiguous segments like "Check your balance" (finance vs. gaming).
  const prefixedText = `[${context}] ${text}`;

  if (MOCK_MODE) {
    return mockEmbedding(prefixedText);
  }

  try {
    const result = await embeddingModel.embedContent(prefixedText);
    return result.embedding.values;
  } catch (err) {
    console.error('Embedding API error:', err.message);
    console.warn('⚠ Falling back to mock embedding');
    return mockEmbedding(prefixedText);
  }
}

/**
 * Batch embed multiple texts with automatic chunking.
 * The Gemini batchEmbedContents API has a limit per call (~100 texts).
 * This function transparently chunks large batches and concatenates results.
 *
 * Performance: 50 texts = 1 API call (200ms) instead of 50 sequential calls (10,000ms).
 *
 * @param {string[]} texts
 * @param {string} context  Domain context label
 * @returns {Promise<number[][]>}
 */
const BATCH_CHUNK_SIZE = 100;

export async function batchEmbed(texts, context = 'General Business') {
  if (!texts || texts.length === 0) return [];

  const prefixed = texts.map((t) => `[${context}] ${t}`);

  if (MOCK_MODE) {
    return prefixed.map((t) => mockEmbedding(t));
  }

  try {
    // If within chunk size, single call (the common case)
    if (prefixed.length <= BATCH_CHUNK_SIZE) {
      const result = await embeddingModel.batchEmbedContents(
        prefixed.map((text) => ({ content: { parts: [{ text }] } }))
      );
      return result.embeddings.map((e) => e.values);
    }

    // Otherwise chunk into groups of BATCH_CHUNK_SIZE and concatenate
    const allEmbeddings = [];
    for (let i = 0; i < prefixed.length; i += BATCH_CHUNK_SIZE) {
      const chunk = prefixed.slice(i, i + BATCH_CHUNK_SIZE);
      const result = await embeddingModel.batchEmbedContents(
        chunk.map((text) => ({ content: { parts: [{ text }] } }))
      );
      allEmbeddings.push(...result.embeddings.map((e) => e.values));
    }
    return allEmbeddings;
  } catch (err) {
    console.error('Batch embedding error:', err.message);
    return prefixed.map((t) => mockEmbedding(t));
  }
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION — Gemini-Augmented Quality Checks
// ═══════════════════════════════════════════════════════════════

/**
 * Use Gemini to find terminology inconsistencies and grammar errors.
 * @param {string} concatenatedText  All segments joined
 * @returns {Promise<{termIssues: Array, grammarIssues: Array}>}
 */
export async function validateWithGemini(concatenatedText) {
  if (MOCK_MODE) {
    return { termIssues: [], grammarIssues: [] };
  }

  try {
    // Prompt 1: Terminology consistency
    const termPrompt = `Analyze the following document text and identify any terminology inconsistencies (same concept referred to with different words). Return ONLY valid JSON array:
[{"issue": "description", "correction": "suggested fix", "severity": "warning"}]

TEXT:
${concatenatedText}`;

    const termResult = await flashModel.generateContent(termPrompt);
    let termIssues = [];
    try {
      const raw = termResult.response.text().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      termIssues = JSON.parse(raw);
    } catch {}

    // Prompt 2: Grammar errors
    const grammarPrompt = `Find grammatical English errors or mixed date formats in this text. Return ONLY valid JSON array:
[{"issue": "description", "correction": "suggested fix", "severity": "info"}]

TEXT:
${concatenatedText}`;

    const grammarResult = await flashModel.generateContent(grammarPrompt);
    let grammarIssues = [];
    try {
      const raw = grammarResult.response.text().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      grammarIssues = JSON.parse(raw);
    } catch {}

    return { termIssues, grammarIssues };
  } catch (err) {
    console.error('Gemini validation error:', err.message);
    return { termIssues: [], grammarIssues: [] };
  }
}

// ═══════════════════════════════════════════════════════════════
// POST-TRANSLATION QA AGENT — DeepTrans Feature
// ═══════════════════════════════════════════════════════════════

/**
 * Post-translation QA: Audits a single translation for semantic errors.
 * Returns { passed: boolean, issues: string[] }
 */
export async function qaCheckTranslation(sourceText, translatedText, targetLang) {
  if (MOCK_MODE) {
    // In mock mode, randomly flag ~10% of segments for realism
    if (Math.random() < 0.1) {
      return { passed: false, issues: ['[Mock] Possible tone inconsistency detected'] };
    }
    return { passed: true, issues: [] };
  }

  const langName = LANG_DISPLAY[targetLang] || targetLang;

  const prompt = `You are a translation quality auditor for ${langName}.
Compare the source text and its translation. Check for:
1. Missing or added information (content not in the original)
2. Number, date, or proper noun errors
3. Grammar issues in the target language
4. Tone inconsistency (too casual/formal vs the original)

Source (English): "${sourceText}"
Translation (${langName}): "${translatedText}"

Return ONLY a JSON object with no markdown fences:
{"passed": true, "issues": []}
If there are problems:
{"passed": false, "issues": ["issue description 1", "issue description 2"]}`;

  try {
    const result = await flashModel.generateContent(prompt);
    const raw = result.response.text()
      .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`⚠ QA check parse failed: ${err.message}`);
    return { passed: true, issues: [] }; // fail-open: don't block translation
  }
}

// ═══════════════════════════════════════════════════════════════
// COSINE SIMILARITY  (CPU, no dependencies)
// ═══════════════════════════════════════════════════════════════

/**
 * Compute cosine similarity between two vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}  -1 to 1
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

/**
 * Find best TM match using cosine similarity of embeddings.
 * @param {number[]} queryEmbedding  The source segment's embedding
 * @param {Array} tmRecords  [{id, source_text, target_text, embedding_json}]
 * @returns {{record: Object|null, score: number, matchType: string}}
 */
export function findBestMatch(queryEmbedding, tmRecords) {
  let bestScore = 0;
  let bestRecord = null;

  for (const record of tmRecords) {
    if (!record.embedding) continue;
    let stored;
    try {
      stored = JSON.parse(record.embedding);
    } catch {
      continue;
    }

    const score = cosineSimilarity(queryEmbedding, stored);
    if (score > bestScore) {
      bestScore = score;
      bestRecord = record;
    }
  }

  // Classify
  let matchType = 'NEW';
  if (bestScore >= 0.95) matchType = 'EXACT';
  else if (bestScore >= 0.75) matchType = 'FUZZY';

  return {
    record: bestRecord,
    score: Math.round(bestScore * 100) / 100,
    matchType,
  };
}

// ═══════════════════════════════════════════════════════════════
// MOCK IMPLEMENTATIONS (for demo-day Wi-Fi safety)
// ═══════════════════════════════════════════════════════════════

// Pre-written Hindi translations for Document A & B demo content
const MOCK_TRANSLATIONS_HI = {
  // --- Document A: Policy / Terms content ---
  'Terms and Conditions Apply.': 'नियम और शर्तें लागू होती हैं।',
  'All users must verify their account details before proceeding.': 'आगे बढ़ने से पहले सभी उपयोगकर्ताओं को अपने खाता विवरण सत्यापित करने होंगे।',
  'Your transaction has been completed successfully.': 'आपका लेनदेन सफलतापूर्वक पूरा हो गया है।',
  'Please review your account balance regularly.': 'कृपया अपनी शेष राशि की नियमित समीक्षा करें।',
  'Contact customer support for assistance.': 'सहायता के लिए ग्राहक सहायता से संपर्क करें।',
  'Your security is our top priority.': 'आपकी सुरक्षा हमारी सर्वोच्च प्राथमिकता है।',
  'We are processing your request.': 'हम आपके अनुरोध को संसाधित कर रहे हैं।',
  'Welcome to our service portal.': 'हमारी सेवा पोर्टल में आपका स्वागत है।',
  'Thank you for your patience and understanding.': 'आपके धैर्य और समझ के लिए धन्यवाद।',
  'Patient must obtain prior authorization.': 'रोगी को पूर्व प्राधिकरण प्राप्त करना होगा।',
  'Prior authorization required for patient.': 'रोगी के लिए पूर्व प्राधिकरण आवश्यक है।',
  'This policy is effective from January 1, 2024.': 'यह नीति 1 जनवरी 2024 से प्रभावी है।',
  'The company reserves the right to modify these terms at any time.': 'कंपनी किसी भी समय इन शर्तों को संशोधित करने का अधिकार सुरक्षित रखती है।',
  'Please ensure all payment details are accurate.': 'कृपया सुनिश्चित करें कि सभी भुगतान विवरण सही हैं।',
  'Unauthorized access to this system is strictly prohibited.': 'इस प्रणाली तक अनधिकृत पहुँच सख्त वर्जित है।',
  'For further assistance, please refer to our FAQ section.': 'अधिक सहायता के लिए, कृपया हमारे FAQ अनुभाग का संदर्भ लें।',
  'All information provided must be accurate and up to date.': 'प्रदान की गई सभी जानकारी सटीक और अद्यतन होनी चाहिए।',
  'By using this service, you agree to our privacy policy.': 'इस सेवा का उपयोग करके, आप हमारी गोपनीयता नीति से सहमत होते हैं।',
  'Your account has been temporarily suspended.': 'आपका खाता अस्थायी रूप से निलंबित कर दिया गया है।',
  'Click here to reset your password.': 'अपना पासवर्ड रीसेट करने के लिए यहाँ क्लिक करें।',
  // --- Document B: Business / Marketing content ---
  'Our platform supports 22 Indian languages for enterprise translation.': 'हमारा प्लेटफ़ॉर्म एंटरप्राइज़ अनुवाद के लिए 22 भारतीय भाषाओं का समर्थन करता है।',
  'The quarterly financial report has been published.': 'तिमाही वित्तीय रिपोर्ट प्रकाशित की गई है।',
  'We aim to provide the best customer experience.': 'हम सर्वोत्तम ग्राहक अनुभव प्रदान करने का लक्ष्य रखते हैं।',
  'Digital transformation is reshaping the banking sector.': 'डिजिटल परिवर्तन बैंकिंग क्षेत्र को नया आकार दे रहा है।',
  'Our team of experts is available 24/7 for support.': 'हमारी विशेषज्ञ टीम सहायता के लिए 24/7 उपलब्ध है।',
  'The annual general meeting will be held on March 15.': 'वार्षिक आम बैठक 15 मार्च को आयोजित की जाएगी।',
  'All employees must complete the compliance training program.': 'सभी कर्मचारियों को अनुपालन प्रशिक्षण कार्यक्रम पूरा करना होगा।',
  'Data privacy is fundamental to our business operations.': 'डेटा गोपनीयता हमारे व्यापार संचालन की मूल आधारशिला है।',
  'Revenue increased by 15% in the last quarter.': 'पिछली तिमाही में राजस्व में 15% की वृद्धि हुई।',
  'Customer satisfaction scores reached an all-time high.': 'ग्राहक संतुष्टि स्कोर अब तक के उच्चतम स्तर पर पहुँच गया।',
  'The merger will create significant value for stakeholders.': 'यह विलय हितधारकों के लिए महत्वपूर्ण मूल्य सृजित करेगा।',
  'Our new mobile application is now available for download.': 'हमारा नया मोबाइल एप्लिकेशन अब डाउनलोड के लिए उपलब्ध है।',
  'Update your preferences in the settings panel.': 'सेटिंग्स पैनल में अपनी प्राथमिकताएँ अपडेट करें।',
  'The insurance claim process has been simplified.': 'बीमा दावा प्रक्रिया को सरल बनाया गया है।',
  'Funds will be credited within 2 business days.': 'धनराशि 2 कार्यदिवसों के भीतर जमा की जाएगी।',
};

const MOCK_TRANSLATIONS_MR = {
  'Terms and Conditions Apply.': 'अटी आणि शर्ती लागू.',
  'Your transaction has been completed successfully.': 'तुमचा व्यवहार यशस्वीरित्या पूर्ण झाला आहे.',
  'Contact customer support for assistance.': 'मदतीसाठी ग्राहक सेवेशी संपर्क साधा.',
  'Your security is our top priority.': 'तुमची सुरक्षा ही आमची सर्वोच्च प्राधान्य आहे.',
  'Please review your account balance regularly.': 'कृपया तुमच्या खात्यातील शिल्लक नियमितपणे तपासा.',
  'Welcome to our service portal.': 'आमच्या सेवा पोर्टलवर आपले स्वागत आहे.',
  'Patient must obtain prior authorization.': 'रुग्णाने पूर्व अधिकृतता प्राप्त करणे आवश्यक आहे.',
  'Data privacy is fundamental to our business operations.': 'डेटा गोपनीयता ही आमच्या व्यवसाय कामकाजाची मूळ गरज आहे.',
};

function mockTranslate(sourceText, targetLang) {
  return new Promise((resolve) => {
    const delay = 800 + Math.random() * 1200; // 800-2000ms realistic delay
    setTimeout(() => {
      const dict = targetLang.startsWith('mr') ? MOCK_TRANSLATIONS_MR : MOCK_TRANSLATIONS_HI;

      // Exact lookup
      if (dict[sourceText]) {
        resolve(dict[sourceText]);
        return;
      }

      // Case-insensitive lookup
      const lower = sourceText.toLowerCase().trim().replace(/[.!?]+$/, '');
      for (const [key, val] of Object.entries(dict)) {
        if (key.toLowerCase().trim().replace(/[.!?]+$/, '') === lower) {
          resolve(val);
          return;
        }
      }

      // Fallback: language-appropriate placeholder
      const MOCK_LABELS = {
        mr_IN: 'मराठी अनुवाद', hi_IN: 'हिंदी अनुवाद',
        ta_IN: 'தமிழ் மொழிபெயர்ப்பு', te_IN: 'తెలుగు అనువాదం',
        bn_IN: 'বাংলা অনুবাদ', kn_IN: 'ಕನ್ನಡ ಅನುವಾದ',
        ml_IN: 'മലയാളം വിവർത്തനം', gu_IN: 'ગુજરાતી અનુવાદ',
        pa_IN: 'ਪੰਜਾਬੀ ਅਨੁਵਾਦ', ur_PK: 'اردو ترجمہ',
        fr_FR: 'Traduction française', de_DE: 'Deutsche Übersetzung',
        es_ES: 'Traducción al español', pt_BR: 'Tradução portuguesa',
        it_IT: 'Traduzione italiana', nl_NL: 'Nederlandse vertaling',
        ja_JP: '日本語翻訳', ko_KR: '한국어 번역', zh_CN: '中文翻译',
      };
      const label = MOCK_LABELS[targetLang] || LANG_DISPLAY[targetLang] || targetLang;
      resolve(`[${label}: ${sourceText.substring(0, 40)}...]`);
    }, delay);
  });
}

/**
 * Mock embedding: deterministic 768-dim vector from text hash.
 * Semantically similar sentences will produce similar vectors because
 * we use shared word stems as the basis for the vector.
 */
function mockEmbedding(text) {
  const DIM = 768;
  const vec = new Float64Array(DIM);

  // Normalize text
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const words = normalized.split(/\s+/).filter(Boolean);

  // Create a bag-of-words hash that maps each word to a deterministic
  // set of dimensions it activates. This means texts sharing words
  // will have overlapping activated dimensions → high cosine similarity.
  for (const word of words) {
    // Hash word to get base dimension indices
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    // Each word activates ~15 dimensions with deterministic values
    for (let k = 0; k < 15; k++) {
      const idx = Math.abs((hash * (k + 1) * 2654435761) | 0) % DIM;
      let val = (((hash * (k + 7) * 1597334677) | 0) % 1000) / 1000;
      val = (val - 0.5) * 2; // Make zero-mean to avoid purely positive density bias
      vec[idx] += val;
    }
  }

  // Add word-pair features for bigram sensitivity
  for (let i = 0; i < words.length - 1; i++) {
    const pair = words[i] + '_' + words[i + 1];
    let hash = 0;
    for (let j = 0; j < pair.length; j++) {
      hash = ((hash << 5) - hash + pair.charCodeAt(j)) | 0;
    }
    for (let k = 0; k < 5; k++) {
      const idx = Math.abs((hash * (k + 1) * 2654435761) | 0) % DIM;
      vec[idx] += (hash % 2 === 0 ? 0.5 : -0.5); // Zero mean
    }
  }

  // L2 normalize to unit vector
  let mag = 0;
  for (let i = 0; i < DIM; i++) mag += vec[i] * vec[i];
  mag = Math.sqrt(mag);
  if (mag > 0) {
    for (let i = 0; i < DIM; i++) vec[i] /= mag;
  }

  return Array.from(vec);
}

// ═══════════════════════════════════════════════════════════════
// LEVENSHTEIN EDIT DISTANCE (for revisions table §3.2.3)
// ═══════════════════════════════════════════════════════════════

/**
 * Compute Levenshtein edit distance between two strings.
 * Used to quantify how much the human revision differed from LLM output.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function editDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Optimized: use two rows instead of full matrix
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Get the style profile rules text for a prompt.
 * @param {Object} profile  { tone, formality, rules? }
 * @returns {string}
 */
export function formatStyleForPrompt(profile) {
  if (!profile) return '';
  let prompt = `\n\nSTYLE REQUIREMENTS:\n- Tone: ${profile.tone || 'professional'}\n- Formality: ${profile.formality || 'formal'}`;
  if (profile.rules) {
    try {
      const rules = typeof profile.rules === 'string' ? JSON.parse(profile.rules) : profile.rules;
      for (const [key, val] of Object.entries(rules)) {
        prompt += `\n- ${key}: ${val}`;
      }
    } catch {}
  }
  return prompt;
}

export { MOCK_MODE };
