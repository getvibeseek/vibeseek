import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { CASES_V1 } from './cases-v1'

/**
 * Harness sanity (no API). For every v1 case: a hand-written CORRECT solution
 * must PASS its verify, and the untouched buggy/empty fixture must FAIL it.
 * If either half breaks, the real-API pass rate would be measuring the harness,
 * not the model (the earlier vite-node import bug taught us this).
 */

// Correct reference solutions, keyed by case name → { file: content }.
const SOLUTIONS: Record<string, Record<string, string>> = {
  'bugfix-add': { 'm.mjs': 'export function add(a, b) { return a + b }\n' },
  'bugfix-last': { 'm.mjs': 'export function last(a) { return a[a.length - 1] }\n' },
  'bugfix-factorial': {
    'm.mjs': 'export function factorial(n) { return n === 0 ? 1 : n * factorial(n - 1) }\n',
  },
  'bugfix-iseven': { 'm.mjs': 'export function isEven(n) { return n % 2 === 0 }\n' },
  'bugfix-max': { 'm.mjs': 'export function max(a, b) { return a > b ? a : b }\n' },
  'bugfix-reverse': {
    'm.mjs': 'export function reverseStr(s) { return s.split("").reverse().join("") }\n',
  },
  'bugfix-count': {
    'm.mjs':
      'export function countVowels(s) { let n = 0; for (const c of s) if ("aeiou".includes(c)) n++; return n }\n',
  },
  'feat-clamp': {
    'm.mjs': 'export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)) }\n',
  },
  'feat-unique': { 'm.mjs': 'export function unique(a) { return [...new Set(a)] }\n' },
  'feat-chunk': {
    'm.mjs':
      'export function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }\n',
  },
  'feat-capitalize': {
    'm.mjs':
      'export function capitalizeWords(s) { return s.split(" ").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ") }\n',
  },
  'feat-average': {
    'm.mjs':
      'export function average(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null }\n',
  },
  'feat-palindrome': {
    'm.mjs':
      'export function isPalindrome(s) { const c = s.toLowerCase().replace(/[^a-z0-9]/g, ""); return c === [...c].reverse().join("") }\n',
  },
  'feat-titlecase-slug': {
    'm.mjs':
      'export function slugify(s) { return s.toLowerCase().trim().replace(/[^a-z0-9\\s-]/g, "").replace(/\\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") }\n',
  },
  'test-sum': {
    'sum.mjs': 'export function sum(a, b) { return a + b }\n',
    'sum.test.mjs':
      'import { sum } from "./sum.mjs"\nexport function runTests() { if (sum(2, 3) !== 5) throw new Error("fail"); return true }\n',
  },
  'test-clamp': {
    'c.mjs': 'export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)) }\n',
    'c.test.mjs':
      'import { clamp } from "./c.mjs"\nexport function runTests() { if (clamp(5,0,3)!==3||clamp(-1,0,3)!==0) throw new Error("fail"); return true }\n',
  },
  'test-reverse': {
    'r.mjs': 'export function rev(s) { return [...s].reverse().join("") }\n',
    'r.test.mjs':
      'import { rev } from "./r.mjs"\nexport function runTests() { if (rev("abc")!=="cba") throw new Error("fail"); return true }\n',
  },
  'test-iseven': {
    'e.mjs': 'export const isEven = (n) => n % 2 === 0\n',
    'e.test.mjs':
      'import { isEven } from "./e.mjs"\nexport function runTests() { if (isEven(4)!==true||isEven(7)!==false) throw new Error("fail"); return true }\n',
  },
  'refactor-rename': {
    'greet.mjs': 'export function greet(name) { return "Hi " + name }\n',
    'main.mjs': 'import { greet } from "./greet.mjs"\nexport const run = () => greet("world")\n',
  },
  'refactor-extract-const': {
    'm.mjs':
      'const PI = 3.14159\nexport function circle(r) { return { area: PI * r * r, circ: 2 * PI * r } }\n',
  },
  'refactor-default-param': {
    'm.mjs': 'export function greet(name = "friend") { return "Hello " + name }\n',
  },
  'refactor-arrow': {
    'm.mjs':
      'export const nums = [1, 2, 3, 4]\nexport function doubled() { return nums.map((n) => n * 2) }\n',
  },
  'refactor-dedupe': {
    'm.mjs':
      'export function areaSq(s) { return s * s }\nexport function areaRect(w, h) { return w * h }\nexport function areaSquare2(s) { return areaSq(s) }\n',
  },
  'refactor-guard': {
    'm.mjs':
      'export function describe(n) { if (n <= 0) return "nonpositive"; if (n > 100) return "big"; return "small" }\n',
  },
}

let dir: string
beforeEach(() => (dir = mkdtempSync(join(process.cwd(), '.eval-tmp-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const writeFixture = (files: Record<string, string>): void => {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    writeFileSync(join(dir, p), content, 'utf8')
  }
}

describe('cases-v1 harness sanity', () => {
  it('every case has a reference solution', () => {
    for (const c of CASES_V1) expect(SOLUTIONS[c.name], c.name).toBeTruthy()
  })

  for (const c of CASES_V1) {
    it(`${c.name}: correct solution passes`, async () => {
      writeFixture(SOLUTIONS[c.name])
      expect(await c.verify(dir)).toBe(true)
    })
    it(`${c.name}: untouched buggy fixture fails`, async () => {
      writeFixture(c.files)
      expect(await c.verify(dir)).toBe(false)
    })
  }
})
