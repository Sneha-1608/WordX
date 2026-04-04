import 'dotenv/config';

const MOCK_MODE = process.env.MOCK_MODE === 'true';

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
  ru_RU: 'Russian', pl_PL: 'Polish', sv_SE: 'Swedish', tr_TR: 'Turkish',
  ar_SA: 'Arabic', th_TH: 'Thai', vi_VN: 'Vietnamese',
};

/**
 * Check if Groq API is available for translation fallback.
 * @returns {boolean}
 */
export function isGroqAvailable() {
  return !MOCK_MODE && !!process.env.GROQ_API_KEY;
}

/**
 * Translate text using Groq API (Llama 3.3 70B) as a fallback.
 * Used when Gemini is rate-limited or unavailable for non-Indian languages.
 *
 * @param {string} sourceText
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {Array} glossaryTerms [{source, target}]
 * @param {string|null} fuzzyRef
 * @param {string} stylePrompt
 * @returns {Promise<{text: string, model: string, engine: string}>}
 */
export async function groqTranslate(sourceText, sourceLang, targetLang, glossaryTerms = [], fuzzyRef = null, stylePrompt = '') {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('Groq API key not configured');
  }

  const langName = LANG_DISPLAY[targetLang] || targetLang;

  let prompt = `You are a professional Enterprise Translator from ${sourceLang} to ${langName} (${targetLang}).
Return ONLY the translated sentence. No XML, no markdown, no explanations, no quotes.

RULES:
- Maintain the same tone and register as the source.
- Preserve any numbers, dates, and proper nouns exactly as they appear.
- Use formal/professional register for business content.`;

  if (stylePrompt) {
    prompt += `\n\nSTYLE REQUIREMENTS:${stylePrompt}`;
  }

  if (glossaryTerms && glossaryTerms.length > 0) {
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

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Groq API error: ${response.status} ${response.statusText} ${errBody}`);
  }

  const data = await response.json();
  let text = (data.choices?.[0]?.message?.content || '').trim();

  // Strip wrapping quotes if present
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1);
  }

  console.log(`   🦙 Groq [${langName}]: "${sourceText.substring(0, 40)}..." → "${text.substring(0, 40)}..."`);

  return {
    text,
    model: 'llama-3.3-70b-versatile',
    engine: 'groq',
  };
}

/**
 * Post-translation QA: Audits a single translation for semantic errors using Llama 3.1.
 * Supports Groq API (if GROQ_API_KEY is present) or local Ollama fallback.
 * Returns { passed: boolean, issues: string[] }
 */
export async function qaCheckTranslationLlama(sourceText, translatedText, targetLang) {
  if (MOCK_MODE) {
    if (Math.random() < 0.1) {
      return { passed: false, issues: ['[Mock Llama] Possible tone inconsistency detected'] };
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
    let rawResult = "";
    
    if (process.env.GROQ_API_KEY) {
      // Use Groq
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          response_format: { type: "json_object" }
        })
      });
      
      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      rawResult = data.choices[0].message.content;
    } else {
      // Use Local Ollama
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama3.1',
          prompt: prompt,
          stream: false,
          format: 'json'
        })
      });
      
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ensure Ollama is running locally with llama3.1 installed`);
      }
      
      const data = await response.json();
      rawResult = data.response;
    }

    const cleaned = rawResult.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const resultJson = JSON.parse(cleaned);
    
    // Ensure the structure matches
    return {
      passed: typeof resultJson.passed === 'boolean' ? resultJson.passed : true,
      issues: Array.isArray(resultJson.issues) ? resultJson.issues : []
    };
  } catch (err) {
    console.warn(`⚠ Llama 3.1 QA check failed: ${err.message}`);
    // fail-open: don't block translation if QA fails
    return { passed: true, issues: [] }; 
  }
}
