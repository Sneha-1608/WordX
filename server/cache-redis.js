// ═══════════════════════════════════════════════════════════════
// Redis Translation Cache — Optional L1 Cache for Translations
// ═══════════════════════════════════════════════════════════════
//
// Wraps ioredis with graceful degradation. If Redis is unavailable,
// all methods resolve without error so the pipeline continues
// through the SQLite/TM path.
//
// ENV: USE_REDIS_CACHE=true + REDIS_URL=redis://localhost:6379
//
// ═══════════════════════════════════════════════════════════════

let redis = null;
let redisReady = false;

async function initRedis() {
  if (process.env.USE_REDIS_CACHE !== 'true') {
    console.log('[Redis] Cache disabled (set USE_REDIS_CACHE=true to enable)');
    return;
  }

  try {
    const Redis = (await import('ioredis')).default;
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
    });

    redis.on('connect', () => {
      redisReady = true;
      console.log('[Redis] Connected and ready');
    });

    redis.on('error', (err) => {
      redisReady = false;
      console.warn('[Redis] Connection error:', err.message);
    });

    redis.on('close', () => {
      redisReady = false;
    });

    await redis.connect();
  } catch (err) {
    console.warn('[Redis] Init failed (translation cache disabled):', err.message);
    redis = null;
    redisReady = false;
  }
}

// Initialize on module load
initRedis();

/**
 * Generate a deterministic cache key for a translation.
 */
function cacheKey(source, sourceLang, targetLang) {
  return `tl:${sourceLang}:${targetLang}:${source.substring(0, 80).replace(/\s+/g, '_')}`;
}

/**
 * Look up a cached translation.
 * @returns {Promise<object|null>} The cached result or null
 */
export async function getCachedTranslation(source, sourceLang, targetLang) {
  if (!redis || !redisReady) return null;
  try {
    const key = cacheKey(source, sourceLang, targetLang);
    const cached = await redis.get(key);
    if (cached) {
      console.log(`[Redis] Cache HIT: ${key.substring(0, 40)}...`);
      return JSON.parse(cached);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Store a translation in the cache.
 * @param {object} result - The translation result object
 * @param {number} ttl - Time to live in seconds (default: 24h)
 */
export async function setCachedTranslation(source, sourceLang, targetLang, result, ttl = 86400) {
  if (!redis || !redisReady) return;
  try {
    const key = cacheKey(source, sourceLang, targetLang);
    await redis.set(key, JSON.stringify(result), 'EX', ttl);
  } catch {
    // Silent fail — cache is optional
  }
}

/**
 * Invalidate a cached translation (e.g., after TM update).
 */
export async function invalidateCache(source, sourceLang, targetLang) {
  if (!redis || !redisReady) return;
  try {
    const key = cacheKey(source, sourceLang, targetLang);
    await redis.del(key);
  } catch {}
}

/**
 * Health check — returns Redis connection status.
 */
export function getRedisStatus() {
  return {
    enabled: process.env.USE_REDIS_CACHE === 'true',
    connected: redisReady,
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  };
}

export default {
  getCachedTranslation,
  setCachedTranslation,
  invalidateCache,
  getRedisStatus,
};
