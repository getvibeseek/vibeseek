import { createHash } from 'node:crypto'
import type { ToolDef } from '../provider/types'

/**
 * Recursively sort object keys so JSON serialization is deterministic. CACHING
 * RULE 2: tool definitions must serialize byte-identically every session
 * regardless of authoring key order, or the cached prefix breaks.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}

/** Canonical JSON for the tool set: tools sorted by name, keys sorted recursively. */
export function serializeTools(tools: ToolDef[]): string {
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name))
  return JSON.stringify(canonicalize(sorted))
}

/** Stable content fingerprint (sha256, hex). */
export function fingerprint(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Index of the first differing character, or -1 if equal. */
export function firstDiff(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return a.length === b.length ? -1 : n
}
