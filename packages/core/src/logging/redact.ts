/**
 * Secret redaction for logs. This is a hard rule: an API key must never
 * reach disk. Every value written to any log channel passes through redact*().
 */

// DeepSeek-style keys: sk- followed by token chars. Also catches longer variants.
const API_KEY_RE = /sk-[A-Za-z0-9_-]{8,}/g
// Authorization: Bearer <token>  (case-insensitive header name)
const BEARER_RE = /(bearer\s+)[A-Za-z0-9._-]+/gi

/** Object keys whose values are always secrets, regardless of content. */
const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'authorization',
  'token',
  'password',
  'secret',
])

/** Redact secrets from a raw string. */
export function redactString(input: string): string {
  // Bearer first: it consumes the whole token (incl. an sk- prefix). Running the
  // key pass first would leave "sk-***" that the bearer pass then double-masks.
  return input.replace(BEARER_RE, '$1***').replace(API_KEY_RE, 'sk-***')
}

/**
 * Deep-redact a value: applies string redaction to all strings, and fully masks
 * values under sensitive keys. Returns a new structure; the input is untouched.
 */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(redactSecrets)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? '***' : redactSecrets(v)
    }
    return out
  }
  return value
}
