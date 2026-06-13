import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HARD_CASES } from './hard-cases'

/** Harness sanity: a hand-written CORRECT implementation must pass verify —
 *  otherwise the judge experiment measures the harness, not the model. */

const CORRECT: Record<string, Record<string, string>> = {
  'email-plus': {
    'validate.mjs': `export function validateEmail(s) {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$/.test(s)
}
`,
  },
  'parse-duration': {
    'duration.mjs': `export const SECONDS_PER_HOUR = 3600
export function parseDuration(str) {
  if (typeof str !== 'string' || str === '') return null
  const m = /^(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?$/.exec(str)
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null
  return (Number(m[1] ?? 0)) * 3600 + (Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)
}
`,
  },
  'paginate-clamp': {
    'page.mjs': `export function paginate(items, page, size) {
  const totalPages = Math.max(1, Math.ceil(items.length / size))
  const p = Math.min(Math.max(1, page), totalPages)
  return { items: items.slice((p - 1) * size, p * size), page: p, totalPages }
}
`,
  },
  'csv-escape': {
    'csv.mjs': `export function toCsvRow(fields) {
  return fields
    .map((f) => (/[",\\n]/.test(f) ? '"' + f.replaceAll('"', '""') + '"' : f))
    .join(',')
}
`,
  },
}

let dir: string
// IN-ROOT temp dir: vite-node refuses to dynamic-import modules outside the
// project root, so eval fixtures that get imported must live under it.
beforeEach(() => (dir = mkdtempSync(join(process.cwd(), '.eval-tmp-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('hard-cases verify sanity', () => {
  for (const c of HARD_CASES) {
    it(`${c.name}: correct implementation passes`, async () => {
      for (const [name, content] of Object.entries(CORRECT[c.name])) {
        writeFileSync(join(dir, name), content, 'utf8')
      }
      expect(await c.verify(dir)).toBe(true)
    })
  }
})
