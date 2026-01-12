/**
 * Simple in-memory rate limiter using sliding window algorithm.
 *
 * For production with multiple server instances, replace with:
 * - @upstash/ratelimit for serverless
 * - Redis-based implementation for traditional servers
 *
 * This implementation is suitable for:
 * - Single-instance deployments
 * - Development/testing
 * - Small-scale production (~20 users)
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store - will be cleared on server restart
// Note: This runs in Edge runtime (middleware), so we use a simple Map
// without Node.js-specific cleanup timers
const rateLimitStore = new Map<string, RateLimitEntry>();

// Simple cleanup: remove expired entries when checking (lazy cleanup)
// This avoids Node.js-specific APIs that don't work in Edge runtime
function cleanupExpired() {
  const now = Date.now();
  // Only cleanup if map is getting large (>1000 entries)
  if (rateLimitStore.size > 1000) {
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt < now) {
        rateLimitStore.delete(key);
      }
    }
  }
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  success: boolean;
  /** Number of requests remaining in the current window */
  remaining: number;
  /** Unix timestamp (ms) when the rate limit resets */
  reset: number;
  /** Total limit for the window */
  limit: number;
}

/**
 * Check rate limit for a given identifier (e.g., IP address, user ID)
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  cleanupExpired();

  const now = Date.now();
  const key = `${identifier}:${config.limit}:${config.windowSeconds}`;
  const windowMs = config.windowSeconds * 1000;

  let entry = rateLimitStore.get(key);

  // Create new entry or reset expired entry
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + windowMs,
    };
  }

  // Increment count
  entry.count++;
  rateLimitStore.set(key, entry);

  const remaining = Math.max(0, config.limit - entry.count);
  const success = entry.count <= config.limit;

  return {
    success,
    remaining,
    reset: entry.resetAt,
    limit: config.limit,
  };
}

/**
 * Pre-configured rate limit configurations
 */
export const RateLimitConfigs = {
  /** Strict limit for auth endpoints - 5 requests per minute */
  auth: { limit: 5, windowSeconds: 60 } as RateLimitConfig,

  /** Standard limit for API endpoints - 30 requests per minute */
  api: { limit: 30, windowSeconds: 60 } as RateLimitConfig,

  /** Limit for file uploads - 10 uploads per minute */
  upload: { limit: 10, windowSeconds: 60 } as RateLimitConfig,

  /** Limit for cron endpoints - 2 requests per minute (should be called by scheduler only) */
  cron: { limit: 2, windowSeconds: 60 } as RateLimitConfig,

  /** Very strict limit for password reset, etc. - 3 requests per 5 minutes */
  sensitive: { limit: 3, windowSeconds: 300 } as RateLimitConfig,
};

/**
 * Get client IP from request headers
 */
export function getClientIP(request: Request): string {
  // Check common proxy headers
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first (original client)
    return forwardedFor.split(",")[0].trim();
  }

  const realIP = request.headers.get("x-real-ip");
  if (realIP) {
    return realIP;
  }

  // Fallback - in development this will often be empty
  return "unknown";
}

/**
 * Create rate limit headers for response
 */
export function createRateLimitHeaders(result: RateLimitResult): Headers {
  const headers = new Headers();
  headers.set("X-RateLimit-Limit", result.limit.toString());
  headers.set("X-RateLimit-Remaining", result.remaining.toString());
  headers.set("X-RateLimit-Reset", Math.ceil(result.reset / 1000).toString());
  return headers;
}
