import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 全库 vs 检索 eval fixture: a synthetic ~36-file project where every
 * task names a BEHAVIOR, not a file — search mode must locate the code first,
 * repo mode already has everything in context. Deterministic content so the
 * repo digest is byte-stable (same prefix across runs ⇒ honest cache math).
 */

export interface RepoEvalCase {
  name: string
  prompt: string
  verify: (dir: string) => Promise<boolean>
}

const read = async (dir: string, p: string): Promise<string> => {
  try {
    return await readFile(join(dir, p), 'utf8')
  } catch {
    return ''
  }
}

/** ~30 filler modules + 3 planted targets, all plausible small JS. */
export function buildRepoFixture(): Record<string, string> {
  const files: Record<string, string> = {}

  const AREAS = ['auth', 'store', 'ui', 'queue', 'log']
  for (const area of AREAS) {
    for (let i = 1; i <= 6; i++) {
      files[`src/${area}/${area}-${i}.js`] = [
        `// ${area} module ${i}`,
        `export function ${area}Task${i}(input) {`,
        `  const normalized = String(input ?? '').trim()`,
        `  if (!normalized) return null`,
        `  return { area: '${area}', step: ${i}, value: normalized }`,
        `}`,
        ``,
        `export function ${area}Check${i}(state) {`,
        `  return Boolean(state && state.area === '${area}' && state.step === ${i})`,
        `}`,
        ``,
      ].join('\n')
    }
  }

  // Target 1 (bugfix): discount applied AFTER tax — should be before.
  files['src/billing/invoice-totals.js'] = [
    `// Order settlement: subtotal -> discount -> tax.`,
    `const TAX_RATE = 0.13`,
    ``,
    `export function orderTotal(subtotal, discount) {`,
    `  const taxed = subtotal * (1 + TAX_RATE)`,
    `  return taxed - discount`,
    `}`,
    ``,
  ].join('\n')

  // Target 2 (config): retry attempts constant.
  files['src/net/http-retry.js'] = [
    `// Outbound HTTP with naive retry.`,
    `const MAX_ATTEMPTS = 3`,
    ``,
    `export async function fetchWithRetry(url) {`,
    `  let lastErr`,
    `  for (let i = 0; i < MAX_ATTEMPTS; i++) {`,
    `    try {`,
    `      return await fetch(url)`,
    `    } catch (e) {`,
    `      lastErr = e`,
    `    }`,
    `  }`,
    `  throw lastErr`,
    `}`,
    ``,
  ].join('\n')

  // Target 3 (feature): the date-helpers module to extend.
  files['src/text/dates.js'] = [
    `// Date/time formatting helpers.`,
    `export function formatDate(ts) {`,
    `  return new Date(ts).toISOString().slice(0, 10)`,
    `}`,
    ``,
    `export function formatTime(ts) {`,
    `  return new Date(ts).toISOString().slice(11, 19)`,
    `}`,
    ``,
  ].join('\n')

  return files
}

export const REPO_CASES: RepoEvalCase[] = [
  {
    name: 'find-fix-discount',
    prompt:
      'Somewhere in this project, the order total applies the discount AFTER tax. ' +
      'It must subtract the discount from the subtotal BEFORE applying tax. Find the code and fix it.',
    verify: async (d) => {
      const t = await read(d, 'src/billing/invoice-totals.js')
      // discount leaves the post-tax line and joins the pre-tax computation
      return /subtotal\s*-\s*discount/.test(t) && !/taxed\s*-\s*discount/.test(t)
    },
  },
  {
    name: 'find-bump-retries',
    prompt: 'Increase the HTTP retry attempts in this project from 3 to 5.',
    verify: async (d) => /MAX_ATTEMPTS = 5/.test(await read(d, 'src/net/http-retry.js')),
  },
  {
    name: 'find-extend-dates',
    prompt:
      'Add an exported function formatDuration(ms) to the module that already holds the ' +
      'date/time formatting helpers. It should render e.g. 90061000 as "25h 1m 1s".',
    verify: async (d) => {
      const t = await read(d, 'src/text/dates.js')
      return /export function formatDuration/.test(t)
    },
  },
]
