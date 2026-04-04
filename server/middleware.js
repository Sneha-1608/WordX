// ═══════════════════════════════════════════════════════════════
// Rate Limiter + Error Handling Middleware
// ═══════════════════════════════════════════════════════════════

/**
 * Gemini API Rate Limiter — 15 RPM with exponential backoff.
 * Tracks timestamps of recent requests and delays when close to limit.
 */
class GeminiRateLimiter {
  constructor(maxRPM = 15) {
    this.maxRPM = maxRPM;
    this.timestamps = [];
    this.queue = [];
    this.processing = false;
  }

  _cleanup() {
    const oneMinuteAgo = Date.now() - 60000;
    this.timestamps = this.timestamps.filter((t) => t > oneMinuteAgo);
  }

  canProceed() {
    this._cleanup();
    return this.timestamps.length < this.maxRPM;
  }

  record() {
    this.timestamps.push(Date.now());
  }

  getWaitTime() {
    this._cleanup();
    if (this.timestamps.length < this.maxRPM) return 0;
    // Wait until the oldest request falls out of the 1-min window
    const oldest = this.timestamps[0];
    return Math.max(0, oldest + 60000 - Date.now() + 100);
  }

  /**
   * Execute a function with rate limiting + exponential backoff.
   * @param {Function} fn  Async function to execute
   * @param {number} maxRetries
   * @returns {Promise<any>}
   */
  async execute(fn, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Wait for rate limit window
      const waitTime = this.getWaitTime();
      if (waitTime > 0) {
        console.log(`⏳ Rate limit: waiting ${waitTime}ms (attempt ${attempt + 1})`);
        await new Promise((r) => setTimeout(r, waitTime));
      }

      try {
        this.record();
        return await fn();
      } catch (err) {
        if (err.status === 429 || err.message?.includes('429') || err.message?.includes('RATE_LIMIT')) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 30000);
          console.warn(`⚠ Rate limited (429). Backing off ${backoff}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        // Non-rate-limit error — rethrow
        throw err;
      }
    }
    throw new Error('Max retries exceeded for Gemini API call');
  }
}

// Singleton rate limiter
export const rateLimiter = new GeminiRateLimiter(15);

// ═══════════════════════════════════════════════════════════════
// Centralized Language Registry
// ═══════════════════════════════════════════════════════════════

export const SUPPORTED_LANGUAGES = [
  // ── Indian Languages (Sarvam AI) ──
  'hi_IN', 'ta_IN', 'te_IN', 'kn_IN', 'ml_IN', 'bn_IN', 'mr_IN',
  'gu_IN', 'pa_IN', 'or_IN', 'as_IN', 'mai_IN', 'sd_IN', 'ks_IN',
  'ne_NP', 'ur_PK', 'si_LK', 'mni_IN', 'brx_IN', 'doi_IN',
  'sat_IN', 'kok_IN', 'sa_IN',
  // ── European Languages (Gemini) ──
  'fr_FR', 'de_DE', 'es_ES', 'pt_BR', 'it_IT', 'nl_NL',
  'ru_RU', 'pl_PL', 'sv_SE', 'tr_TR',
  // ── East Asian (Gemini) ──
  'ja_JP', 'ko_KR', 'zh_CN',
  // ── Other (Gemini) ──
  'ar_SA', 'th_TH', 'vi_VN',
  // ── Source languages ──
  'en',
];

// Display names for all languages
export const LANGUAGE_NAMES = {
  en: 'English',
  // Indian
  hi_IN: 'Hindi', ta_IN: 'Tamil', te_IN: 'Telugu', kn_IN: 'Kannada',
  ml_IN: 'Malayalam', bn_IN: 'Bengali', mr_IN: 'Marathi', gu_IN: 'Gujarati',
  pa_IN: 'Punjabi', or_IN: 'Odia', as_IN: 'Assamese', mai_IN: 'Maithili',
  sd_IN: 'Sindhi', ks_IN: 'Kashmiri', ne_NP: 'Nepali', ur_PK: 'Urdu',
  si_LK: 'Sinhala', mni_IN: 'Manipuri', brx_IN: 'Bodo', doi_IN: 'Dogri',
  sat_IN: 'Santali', kok_IN: 'Konkani', sa_IN: 'Sanskrit',
  // European
  fr_FR: 'French', de_DE: 'German', es_ES: 'Spanish', pt_BR: 'Portuguese',
  it_IT: 'Italian', nl_NL: 'Dutch', ru_RU: 'Russian', pl_PL: 'Polish',
  sv_SE: 'Swedish', tr_TR: 'Turkish',
  // East Asian
  ja_JP: 'Japanese', ko_KR: 'Korean', zh_CN: 'Chinese',
  // Other
  ar_SA: 'Arabic', th_TH: 'Thai', vi_VN: 'Vietnamese',
};

export function isLanguageSupported(lang) {
  return SUPPORTED_LANGUAGES.includes(lang);
}

export function getLanguageName(code) {
  return LANGUAGE_NAMES[code] || code;
}

// ═══════════════════════════════════════════════════════════════
// Centralized Error Handler Middleware
// ═══════════════════════════════════════════════════════════════

export function errorHandler(err, req, res, next) {
  console.error(`[${req.method} ${req.path}]`, err.message);

  // Structured error response
  const status = err.status || err.statusCode || 500;
  const response = {
    error: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
    path: req.path,
    timestamp: new Date().toISOString(),
  };

  // Specific error types
  if (err.message?.includes('RATE_LIMIT') || status === 429) {
    response.code = 'RATE_LIMITED';
    response.retryAfter = 60;
    res.setHeader('Retry-After', '60');
    return res.status(429).json(response);
  }

  if (err.message?.includes('language')) {
    response.code = 'UNSUPPORTED_LANGUAGE';
    response.supportedLanguages = SUPPORTED_LANGUAGES;
    return res.status(400).json(response);
  }

  if (err.message?.includes('embedding')) {
    response.code = 'EMBEDDING_FAILURE';
    response.fallback = 'Using exact string match as fallback';
    return res.status(200).json(response); // Don't fail on embedding errors
  }

  return res.status(status).json(response);
}

// Request logging middleware
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const emoji = res.statusCode < 400 ? '✅' : res.statusCode < 500 ? '⚠️' : '❌';
    console.log(`${emoji} ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
  });
  next();
}
