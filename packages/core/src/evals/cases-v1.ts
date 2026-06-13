import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Eval set v1 (the "放开规模" run). 24 self-contained tasks across the
 * four categories, verified by IMPORTING the produced module and exercising
 * its real behavior (not regex) — the only way the pass rate is credible.
 *
 * Fixtures are .mjs so dynamic import works without a package.json. The host
 * MUST run these from an in-project-root temp dir (vite-node refuses to import
 * modules outside the project root) — see bench.ts.
 */

export type EvalCategory = 'bugfix' | 'feature' | 'test' | 'refactor'

export interface EvalCaseV1 {
  name: string
  category: EvalCategory
  files: Record<string, string>
  prompt: string
  verify: (dir: string) => Promise<boolean>
}

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

const fn = (
  m: Record<string, unknown> | null,
  name: string
): ((...a: never[]) => unknown) | null =>
  m && typeof m[name] === 'function' ? (m[name] as (...a: never[]) => unknown) : null

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Read a fixture file's source (for structural checks on refactor cases —
 *  behavior alone can't tell whether the refactor was actually performed). */
const src = (dir: string, file: string): string => {
  try {
    return readFileSync(join(dir, file), 'utf8')
  } catch {
    return ''
  }
}

export const CASES_V1: EvalCaseV1[] = [
  // ---------- bugfix (7) ----------
  {
    name: 'bugfix-add',
    category: 'bugfix',
    files: { 'm.mjs': 'export function add(a, b) {\n  return a - b\n}\n' },
    prompt: 'add() in m.mjs wrongly subtracts. Make it add.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'add')
      return !!f && f(2 as never, 3 as never) === 5 && f(10 as never, -4 as never) === 6
    },
  },
  {
    name: 'bugfix-last',
    category: 'bugfix',
    files: { 'm.mjs': 'export function last(a) {\n  return a[a.length]\n}\n' },
    prompt: 'last() has an off-by-one bug; it should return the final element.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'last')
      return !!f && f([1, 2, 3] as never) === 3 && f(['x'] as never) === 'x'
    },
  },
  {
    name: 'bugfix-factorial',
    category: 'bugfix',
    files: {
      'm.mjs': 'export function factorial(n) {\n  return n === 0 ? 0 : n * factorial(n - 1)\n}\n',
    },
    prompt: 'factorial() returns 0 for everything because the base case is wrong. Fix it (0! = 1).',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'factorial')
      return !!f && f(0 as never) === 1 && f(5 as never) === 120
    },
  },
  {
    name: 'bugfix-iseven',
    category: 'bugfix',
    files: { 'm.mjs': 'export function isEven(n) {\n  return n % 2 === 1\n}\n' },
    prompt: 'isEven() is inverted. Fix it.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'isEven')
      return !!f && f(4 as never) === true && f(3 as never) === false && f(0 as never) === true
    },
  },
  {
    name: 'bugfix-max',
    category: 'bugfix',
    files: { 'm.mjs': 'export function max(a, b) {\n  return a < b ? a : b\n}\n' },
    prompt: 'max() actually returns the smaller value. Fix it to return the larger.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'max')
      return !!f && f(3 as never, 7 as never) === 7 && f(9 as never, 2 as never) === 9
    },
  },
  {
    name: 'bugfix-reverse',
    category: 'bugfix',
    files: {
      'm.mjs': 'export function reverseStr(s) {\n  return s.split("").join("")\n}\n',
    },
    prompt: 'reverseStr() should reverse the string but returns it unchanged. Fix it.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'reverseStr')
      return !!f && f('abc' as never) === 'cba' && f('x' as never) === 'x'
    },
  },
  {
    name: 'bugfix-count',
    category: 'bugfix',
    files: {
      'm.mjs':
        'export function countVowels(s) {\n  let n = 0\n  for (const c of s) if ("aeiou".includes(c)) n++\n  return s.length\n}\n',
    },
    prompt: 'countVowels() returns the string length instead of the vowel count. Fix it.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'countVowels')
      return !!f && f('hello' as never) === 2 && f('xyz' as never) === 0
    },
  },

  // ---------- feature (7) ----------
  {
    name: 'feat-clamp',
    category: 'feature',
    files: { 'm.mjs': '// utils\n' },
    prompt:
      'In m.mjs add an exported clamp(value, min, max) returning value bounded to [min, max].',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'clamp')
      return (
        !!f &&
        f(5 as never, 0 as never, 10 as never) === 5 &&
        f(-3 as never, 0 as never, 10 as never) === 0 &&
        f(99 as never, 0 as never, 10 as never) === 10
      )
    },
  },
  {
    name: 'feat-unique',
    category: 'feature',
    files: { 'm.mjs': '// utils\n' },
    prompt:
      'In m.mjs add an exported unique(arr) that removes duplicates while preserving first-seen order.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'unique')
      return !!f && eq(f([1, 2, 2, 3, 1] as never), [1, 2, 3]) && eq(f([] as never), [])
    },
  },
  {
    name: 'feat-chunk',
    category: 'feature',
    files: { 'm.mjs': '// utils\n' },
    prompt:
      'In m.mjs add an exported chunk(arr, size) splitting arr into arrays of at most size; the last may be shorter.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'chunk')
      return (
        !!f &&
        eq(f([1, 2, 3, 4, 5] as never, 2 as never), [[1, 2], [3, 4], [5]]) &&
        eq(f([] as never, 3 as never), [])
      )
    },
  },
  {
    name: 'feat-capitalize',
    category: 'feature',
    files: { 'm.mjs': '// utils\n' },
    prompt:
      'In m.mjs add an exported capitalizeWords(s) that upper-cases the first letter of each space-separated word.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'capitalizeWords')
      return !!f && f('hello world' as never) === 'Hello World' && f('a b c' as never) === 'A B C'
    },
  },
  {
    name: 'feat-average',
    category: 'feature',
    files: { 'm.mjs': '// utils\n' },
    prompt:
      'In m.mjs add an exported average(nums) returning the mean, or null for an empty array.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'average')
      return !!f && f([2, 4, 6] as never) === 4 && f([] as never) === null
    },
  },
  {
    name: 'feat-palindrome',
    category: 'feature',
    files: { 'm.mjs': '// utils\n' },
    prompt:
      'In m.mjs add an exported isPalindrome(s) that ignores case and non-alphanumeric characters.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'isPalindrome')
      return (
        !!f &&
        f('A man, a plan, a canal: Panama' as never) === true &&
        f('hello' as never) === false
      )
    },
  },
  {
    name: 'feat-titlecase-slug',
    category: 'feature',
    files: { 'm.mjs': '// utils\n' },
    prompt:
      'In m.mjs add an exported slugify(s): lower-case, spaces→hyphens, drop non-alphanumeric-or-hyphen, collapse repeated hyphens, trim leading/trailing hyphens.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'slugify')
      return (
        !!f && f('  Hello, World!  ' as never) === 'hello-world' && f('a   b' as never) === 'a-b'
      )
    },
  },

  // ---------- test (4) — verified by importing the test file's checks ----------
  {
    name: 'test-sum',
    category: 'test',
    files: { 'sum.mjs': 'export function sum(a, b) {\n  return a + b\n}\n' },
    prompt:
      'Create sum.test.mjs that imports sum from ./sum.mjs and EXPORTS a function runTests() which throws if sum(2,3) !== 5, otherwise returns true.',
    verify: async (d) => {
      const f = fn(await load(d, 'sum.test.mjs'), 'runTests')
      try {
        return !!f && f() === true
      } catch {
        return false
      }
    },
  },
  {
    name: 'test-clamp',
    category: 'test',
    files: {
      'c.mjs': 'export function clamp(v, lo, hi) {\n  return Math.min(hi, Math.max(lo, v))\n}\n',
    },
    prompt:
      'Create c.test.mjs importing clamp from ./c.mjs, exporting runTests() that throws unless clamp(5,0,3)===3 and clamp(-1,0,3)===0, else returns true.',
    verify: async (d) => {
      const f = fn(await load(d, 'c.test.mjs'), 'runTests')
      try {
        return !!f && f() === true
      } catch {
        return false
      }
    },
  },
  {
    name: 'test-reverse',
    category: 'test',
    files: { 'r.mjs': 'export function rev(s) {\n  return [...s].reverse().join("")\n}\n' },
    prompt:
      'Create r.test.mjs importing rev from ./r.mjs, exporting runTests() that throws unless rev("abc")==="cba", else returns true.',
    verify: async (d) => {
      const f = fn(await load(d, 'r.test.mjs'), 'runTests')
      try {
        return !!f && f() === true
      } catch {
        return false
      }
    },
  },
  {
    name: 'test-iseven',
    category: 'test',
    files: { 'e.mjs': 'export const isEven = (n) => n % 2 === 0\n' },
    prompt:
      'Create e.test.mjs importing isEven from ./e.mjs, exporting runTests() that throws unless isEven(4)===true and isEven(7)===false, else returns true.',
    verify: async (d) => {
      const f = fn(await load(d, 'e.test.mjs'), 'runTests')
      try {
        return !!f && f() === true
      } catch {
        return false
      }
    },
  },

  // ---------- refactor (6) — behavior must be preserved ----------
  {
    name: 'refactor-rename',
    category: 'refactor',
    files: {
      'greet.mjs': 'export function sayHi(name) {\n  return "Hi " + name\n}\n',
      'main.mjs': 'import { sayHi } from "./greet.mjs"\nexport const run = () => sayHi("world")\n',
    },
    prompt:
      'Rename sayHi to greet across greet.mjs and main.mjs (definition + import + call). Keep behavior identical.',
    verify: async (d) => {
      const g = await load(d, 'greet.mjs')
      const m = await load(d, 'main.mjs')
      const greet = fn(g, 'greet')
      const run = fn(m, 'run')
      return !!greet && !!run && greet('x' as never) === 'Hi x' && run() === 'Hi world'
    },
  },
  {
    name: 'refactor-extract-const',
    category: 'refactor',
    files: {
      'm.mjs':
        'export function circle(r) {\n  return { area: 3.14159 * r * r, circ: 2 * 3.14159 * r }\n}\n',
    },
    prompt:
      'Refactor m.mjs to extract the magic number 3.14159 into a single PI constant used in both places. Behavior unchanged.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'circle')
      if (!f) return false
      const r = f(2 as never) as { area: number; circ: number }
      const behaviorOk = Math.abs(r.area - 12.56636) < 1e-6 && Math.abs(r.circ - 12.56636) < 1e-6
      // The literal must appear at most once now (extracted into a constant).
      const literals = (src(d, 'm.mjs').match(/3\.14159/g) ?? []).length
      return behaviorOk && literals <= 1
    },
  },
  {
    name: 'refactor-default-param',
    category: 'refactor',
    files: {
      'm.mjs':
        'export function greet(name) {\n  if (name === undefined) name = "friend"\n  return "Hello " + name\n}\n',
    },
    prompt:
      'Refactor greet() in m.mjs to use a default parameter instead of the manual undefined check. Behavior unchanged.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'greet')
      const behaviorOk =
        !!f && f(undefined as never) === 'Hello friend' && f('Sam' as never) === 'Hello Sam'
      const s = src(d, 'm.mjs')
      // Default param present, manual undefined check gone.
      return behaviorOk && /name\s*=\s*["']friend["']/.test(s) && !/undefined/.test(s)
    },
  },
  {
    name: 'refactor-arrow',
    category: 'refactor',
    files: {
      'm.mjs':
        'export const nums = [1, 2, 3, 4]\nexport function doubled() {\n  return nums.map(function (n) { return n * 2 })\n}\n',
    },
    prompt:
      'Refactor the map callback in m.mjs from a function expression to an arrow function. Behavior unchanged.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'doubled')
      const s = src(d, 'm.mjs')
      // Arrow used, no `function` expression left.
      return !!f && eq(f(), [2, 4, 6, 8]) && /=>/.test(s) && !/function\s*\(/.test(s)
    },
  },
  {
    name: 'refactor-dedupe',
    category: 'refactor',
    files: {
      'm.mjs':
        'export function areaSq(s) {\n  return s * s\n}\nexport function areaRect(w, h) {\n  return w * h\n}\nexport function areaSquare2(s) {\n  return s * s\n}\n',
    },
    prompt:
      'm.mjs has areaSq and areaSquare2 that do the same thing. Make areaSquare2 delegate to areaSq (call it) while keeping both exports working identically.',
    verify: async (d) => {
      const m = await load(d, 'm.mjs')
      const a = fn(m, 'areaSq')
      const b = fn(m, 'areaSquare2')
      const behaviorOk =
        !!a && !!b && a(4 as never) === 16 && b(4 as never) === 16 && b(5 as never) === 25
      // The duplicate `s * s` in areaSquare2 is gone (it delegates to areaSq).
      const literalSquares = (src(d, 'm.mjs').match(/\bs\s*\*\s*s\b/g) ?? []).length
      return behaviorOk && literalSquares <= 1
    },
  },
  {
    name: 'refactor-guard',
    category: 'refactor',
    files: {
      'm.mjs':
        'export function describe(n) {\n  if (n > 0) {\n    if (n > 100) {\n      return "big"\n    } else {\n      return "small"\n    }\n  } else {\n    return "nonpositive"\n  }\n}\n',
    },
    prompt:
      'Refactor describe() in m.mjs to use early-return guard clauses instead of nested if/else. Behavior unchanged, and no `else` keyword.',
    verify: async (d) => {
      const f = fn(await load(d, 'm.mjs'), 'describe')
      const behaviorOk =
        !!f &&
        f(200 as never) === 'big' &&
        f(5 as never) === 'small' &&
        f(-1 as never) === 'nonpositive'
      // Guard-clause style: the nested else chain is gone.
      return behaviorOk && !/\belse\b/.test(src(d, 'm.mjs'))
    },
  },
]
