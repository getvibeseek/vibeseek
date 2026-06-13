import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Hard eval cases for the goal+judge experiment (方案 backlog #1): tasks where
 * flash+off plausibly misses edge cases on the first try, verified by
 * IMPORTING the produced module and exercising its behavior — not by regex.
 * Files are .mjs so dynamic import works without a package.json.
 */

export interface HardCase {
  name: string
  files: Record<string, string>
  prompt: string
  verify: (dir: string) => Promise<boolean>
}

async function load(dir: string, file: string): Promise<Record<string, unknown> | null> {
  try {
    // @vite-ignore: a runtime temp-dir path — vite-node must NOT try to
    // resolve/transform it (it fails for files outside the project root).
    return (await import(/* @vite-ignore */ pathToFileURL(join(dir, file)).href)) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
}

export const HARD_CASES: HardCase[] = [
  {
    name: 'email-plus',
    files: {
      'validate.mjs': [
        `// User signup validation.`,
        `export function validateEmail(s) {`,
        `  return /^[a-z0-9]+@[a-z0-9]+\\.[a-z]{2,3}$/.test(s)`,
        `}`,
        ``,
      ].join('\n'),
    },
    prompt:
      'Users report that valid emails like "john+tag@example.com", "a.b@mail.co.uk" and ' +
      '"X@Y.COM" are rejected by validateEmail in validate.mjs. Fix it so these pass, while ' +
      'clearly invalid ones ("no-at.com", "a@b", "a b@c.de") are still rejected.',
    verify: async (dir) => {
      const mod = await load(dir, 'validate.mjs')
      const fn = mod?.validateEmail as ((s: string) => boolean) | undefined
      if (typeof fn !== 'function') return false
      const good = ['john+tag@example.com', 'a.b@mail.co.uk', 'X@Y.COM', 'a@b.cn']
      const bad = ['no-at.com', 'a@b', 'a b@c.de', '']
      return good.every((s) => fn(s) === true) && bad.every((s) => fn(s) === false)
    },
  },
  {
    name: 'parse-duration',
    files: {
      'duration.mjs': `// Time helpers live here.\nexport const SECONDS_PER_HOUR = 3600\n`,
    },
    prompt:
      'In duration.mjs, add an exported function parseDuration(str) that parses durations ' +
      'like "2h", "90m", "45s", "1h30m", "1h2m3s" and returns the TOTAL SECONDS as a number. ' +
      'Units may be combined in h→m→s order, each at most once. Return null for anything ' +
      'invalid: empty string, unknown units, a bare number, units out of order.',
    verify: async (dir) => {
      const mod = await load(dir, 'duration.mjs')
      const fn = mod?.parseDuration as ((s: string) => number | null) | undefined
      if (typeof fn !== 'function') return false
      const cases: Array<[string, number | null]> = [
        ['2h', 7200],
        ['90m', 5400],
        ['45s', 45],
        ['1h30m', 5400],
        ['1h2m3s', 3723],
        ['0s', 0],
        ['', null],
        ['h', null],
        ['10', null],
        ['30m1h', null],
      ]
      return cases.every(([input, want]) => fn(input) === want)
    },
  },
  {
    name: 'paginate-clamp',
    files: {
      'page.mjs': `// List utilities.\n`,
    },
    prompt:
      'In page.mjs, add an exported function paginate(items, page, size) for 1-BASED pages. ' +
      'It returns { items, page, totalPages } where items is the requested slice. totalPages ' +
      'is at least 1 even for an empty list. A page below 1 clamps to 1; a page beyond the ' +
      'last clamps to the last page, and the returned `page` reflects the clamped value.',
    verify: async (dir) => {
      const mod = await load(dir, 'page.mjs')
      const fn = mod?.paginate as
        | ((
            items: unknown[],
            page: number,
            size: number
          ) => {
            items: unknown[]
            page: number
            totalPages: number
          })
        | undefined
      if (typeof fn !== 'function') return false
      const ten = Array.from({ length: 10 }, (_, i) => i)
      const a = fn(ten, 2, 3)
      const b = fn(ten, 0, 3) // clamps to 1
      const c = fn(ten, 99, 3) // clamps to 4
      const d = fn([], 1, 5) // empty list
      const e = fn(ten, 4, 3) // last partial page
      return (
        JSON.stringify(a.items) === '[3,4,5]' &&
        a.totalPages === 4 &&
        b.page === 1 &&
        JSON.stringify(b.items) === '[0,1,2]' &&
        c.page === 4 &&
        JSON.stringify(c.items) === '[9]' &&
        d.totalPages === 1 &&
        d.items.length === 0 &&
        JSON.stringify(e.items) === '[9]'
      )
    },
  },
  {
    name: 'csv-escape',
    files: {
      'csv.mjs': `// CSV output helpers.\n`,
    },
    prompt:
      'In csv.mjs, add an exported function toCsvRow(fields) that joins an array of strings ' +
      'into one RFC-4180 CSV row: a field is wrapped in double quotes only when it contains ' +
      'a comma, a double quote or a newline; inner double quotes are doubled. No trailing ' +
      'newline.',
    verify: async (dir) => {
      const mod = await load(dir, 'csv.mjs')
      const fn = mod?.toCsvRow as ((fields: string[]) => string) | undefined
      if (typeof fn !== 'function') return false
      return (
        fn(['a', 'b']) === 'a,b' &&
        fn(['a,b', 'c']) === '"a,b",c' &&
        fn(['say "hi"', 'x']) === '"say ""hi""",x' &&
        fn(['line1\nline2']) === '"line1\nline2"' &&
        fn(['', 'x']) === ',x'
      )
    },
  },
]
