/**
 * Tolerant parsing of tool-call arguments. DeepSeek occasionally emits slightly
 * malformed JSON (trailing commas, prose wrapping the object). We repair what we
 * safely can rather than failing the whole turn (FC defense layer).
 */
export function parseToolArguments(raw: string): Record<string, unknown> {
  const s = raw.trim()
  if (!s) return {}

  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    // fall through to repair
  }

  // Extract the outermost {...} and strip trailing commas.
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start !== -1 && end > start) {
    const candidate = s.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1')
    try {
      return JSON.parse(candidate) as Record<string, unknown>
    } catch {
      // give up
    }
  }
  return {}
}
