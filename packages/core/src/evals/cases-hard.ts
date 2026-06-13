import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { EvalCaseV1 } from './cases-v1'

/**
 * Hard layer. Tasks with real edge cases and multi-file dependency
 * chains — designed to be MISSABLE so the pass rate has discrimination (a set
 * that scores 100% can't tell you where the agent's limit is). Executable
 * verification; in-root temp dirs (vite-node).
 */

async function load(dir: string, file: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(/* @vite-ignore */ pathToFileURL(join(dir, file)).href)) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
}
const fn = (m: Record<string, unknown> | null, n: string): ((...a: never[]) => unknown) | null =>
  m && typeof m[n] === 'function' ? (m[n] as (...a: never[]) => unknown) : null
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export const CASES_HARD: EvalCaseV1[] = [
  {
    name: 'hard-parse-duration',
    category: 'feature',
    files: { 'm.mjs': '// time utils\n' },
    prompt:
      'In m.mjs add an exported parseDuration(str) → total seconds. Accept combinations in h→m→s order, each unit at most once: "2h", "90m", "45s", "1h30m", "1h2m3s", "0s". Return null for invalid input: "" , "h", a bare number like "10", or units out of order like "30m1h".',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'parseDuration')
      if (!f) return false
      const ok: Array<[string, number]> = [
        ['2h', 7200],
        ['90m', 5400],
        ['45s', 45],
        ['1h30m', 5400],
        ['1h2m3s', 3723],
        ['0s', 0],
      ]
      const bad = ['', 'h', '10', '30m1h']
      return ok.every(([i, o]) => f(i as never) === o) && bad.every((i) => f(i as never) === null)
    },
  },
  {
    name: 'hard-csv-row',
    category: 'feature',
    files: { 'm.mjs': '// csv\n' },
    prompt:
      'In m.mjs add an exported toCsvRow(fields) joining an array of strings into one RFC-4180 CSV row: wrap a field in double quotes ONLY if it contains a comma, a double quote, or a newline; double any inner quotes. No trailing newline.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'toCsvRow')
      return (
        !!f &&
        f(['a', 'b'] as never) === 'a,b' &&
        f(['a,b', 'c'] as never) === '"a,b",c' &&
        f(['say "hi"', 'x'] as never) === '"say ""hi""",x' &&
        f(['line1\nline2'] as never) === '"line1\nline2"' &&
        f(['', 'x'] as never) === ',x'
      )
    },
  },
  {
    name: 'hard-paginate',
    category: 'feature',
    files: { 'm.mjs': '// list utils\n' },
    prompt:
      'In m.mjs add an exported paginate(items, page, size) for 1-BASED pages returning { items, page, totalPages }. totalPages is at least 1 even for an empty list. A page below 1 clamps to 1; a page beyond the last clamps to the last page, and the returned page reflects the clamped value.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'paginate') as
        | ((
            i: unknown[],
            p: number,
            s: number
          ) => { items: unknown[]; page: number; totalPages: number })
        | null
      if (!f) return false
      const ten = Array.from({ length: 10 }, (_, i) => i)
      const a = f(ten, 2, 3)
      const b = f(ten, 0, 3)
      const c = f(ten, 99, 3)
      const e = f([], 1, 5)
      return (
        eq(a.items, [3, 4, 5]) &&
        a.totalPages === 4 &&
        b.page === 1 &&
        c.page === 4 &&
        eq(c.items, [9]) &&
        e.totalPages === 1 &&
        e.items.length === 0
      )
    },
  },
  {
    name: 'hard-email',
    category: 'bugfix',
    files: {
      'm.mjs':
        'export function validateEmail(s) {\n  return /^[a-z0-9]+@[a-z0-9]+\\.[a-z]{2,3}$/.test(s)\n}\n',
    },
    prompt:
      'validateEmail in m.mjs rejects valid addresses. Fix the regex so "john+tag@example.com", "a.b@mail.co.uk" and "X@Y.COM" pass, while "no-at.com", "a@b" and "a b@c.de" are still rejected.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'validateEmail')
      if (!f) return false
      const good = ['john+tag@example.com', 'a.b@mail.co.uk', 'X@Y.COM']
      const bad = ['no-at.com', 'a@b', 'a b@c.de', '']
      return good.every((s) => f(s as never) === true) && bad.every((s) => f(s as never) === false)
    },
  },
  {
    name: 'hard-multifile-pipeline',
    category: 'refactor',
    files: {
      'parse.mjs': 'export function parse(s) {\n  return s.split(",").map((x) => x.trim())\n}\n',
      'transform.mjs':
        'import { parse } from "./parse.mjs"\nexport function toUpper(s) {\n  return parse(s).map((x) => x.toUpperCase())\n}\n',
      'index.mjs':
        'import { toUpper } from "./transform.mjs"\nexport function run(s) {\n  return toUpper(s).join("|")\n}\n',
    },
    prompt:
      'parse() in parse.mjs should also drop empty entries (after trimming) before returning. Make that change so the whole pipeline skips blanks. Behavior of run("a, ,b,") must become "A|B". Do not break the imports.',
    verify: async (d) => {
      const f = fn(await load(d, 'index.mjs'), 'run')
      return !!f && f('a, ,b,' as never) === 'A|B' && f('x,y' as never) === 'X|Y'
    },
  },
  {
    name: 'hard-statemachine',
    category: 'feature',
    files: { 'm.mjs': '// traffic light\n' },
    prompt:
      'In m.mjs add an exported nextLight(current) for a traffic light cycling green → yellow → red → green. Unknown input returns "red". So nextLight("green")==="yellow", nextLight("yellow")==="red", nextLight("red")==="green", nextLight("blue")==="red".',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'nextLight')
      return (
        !!f &&
        f('green' as never) === 'yellow' &&
        f('yellow' as never) === 'red' &&
        f('red' as never) === 'green' &&
        f('blue' as never) === 'red'
      )
    },
  },
  {
    name: 'hard-deepget',
    category: 'feature',
    files: { 'm.mjs': '// object utils\n' },
    prompt:
      'In m.mjs add an exported get(obj, path, fallback) reading a dot-path like "a.b.c" from a nested object, returning fallback when any segment is missing. get({a:{b:{c:1}}}, "a.b.c") === 1; get({a:{}}, "a.b.c", 9) === 9; get({}, "x") === undefined.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'get')
      return (
        !!f &&
        f({ a: { b: { c: 1 } } } as never, 'a.b.c' as never) === 1 &&
        f({ a: {} } as never, 'a.b.c' as never, 9 as never) === 9 &&
        f({} as never, 'x' as never) === undefined
      )
    },
  },
  {
    name: 'hard-romans',
    category: 'feature',
    files: { 'm.mjs': '// numerals\n' },
    prompt:
      'In m.mjs add an exported toRoman(n) for 1..3999 using subtractive notation. toRoman(4)==="IV", toRoman(9)==="IX", toRoman(49)==="XLIX", toRoman(1994)==="MCMXCIV", toRoman(3888)==="MMMDCCCLXXXVIII".',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'toRoman')
      return (
        !!f &&
        f(4 as never) === 'IV' &&
        f(9 as never) === 'IX' &&
        f(49 as never) === 'XLIX' &&
        f(1994 as never) === 'MCMXCIV' &&
        f(3888 as never) === 'MMMDCCCLXXXVIII'
      )
    },
  },
]
