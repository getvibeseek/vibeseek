import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type EvalCategory = 'bugfix' | 'feature' | 'test' | 'refactor'

export interface EvalCase {
  name: string
  category: EvalCategory
  /** Fixture files written into a fresh temp dir before the run. */
  files: Record<string, string>
  prompt: string
  /** Auto-judge: inspect the working dir after the run. */
  verify: (dir: string) => Promise<boolean>
}

async function read(dir: string, p: string): Promise<string> {
  try {
    return await readFile(join(dir, p), 'utf8')
  } catch {
    return ''
  }
}

/**
 * Eval set v0. Small, deterministic, content-checked tasks across the four
 * categories. Intentionally tiny so a full run is cheap; cases can later
 * graduate to executable checks.
 */
export const CASES: EvalCase[] = [
  {
    name: 'bugfix-sum',
    category: 'bugfix',
    files: { 'math.js': 'export function add(a, b) {\n  return a - b\n}\n' },
    prompt: 'There is a bug in math.js: add() subtracts instead of adding. Fix it.',
    verify: async (d) =>
      /a\s*\+\s*b/.test(await read(d, 'math.js')) && !/a\s*-\s*b/.test(await read(d, 'math.js')),
  },
  {
    name: 'bugfix-offbyone',
    category: 'bugfix',
    files: { 'last.js': 'export function last(arr) {\n  return arr[arr.length]\n}\n' },
    prompt: 'last.js has an off-by-one bug — it should return the last element. Fix it.',
    verify: async (d) => /arr\.length\s*-\s*1/.test(await read(d, 'last.js')),
  },
  {
    name: 'feature-clamp',
    category: 'feature',
    files: { 'util.js': 'export function double(x) {\n  return x * 2\n}\n' },
    prompt:
      'Add a new exported function clamp(value, min, max) to util.js that returns value bounded to [min, max].',
    verify: async (d) => {
      const t = await read(d, 'util.js')
      return /export function clamp/.test(t) && /Math\.(min|max)/.test(t)
    },
  },
  {
    name: 'test-add',
    category: 'test',
    files: {
      'sum.js': 'export function sum(a, b) {\n  return a + b\n}\n',
    },
    prompt:
      'Write a test file sum.test.js that imports sum from ./sum.js and asserts sum(2, 3) === 5.',
    verify: async (d) => {
      const t = await read(d, 'sum.test.js')
      return /sum/.test(t) && /5/.test(t)
    },
  },
  {
    name: 'refactor-rename',
    category: 'refactor',
    files: {
      'greet.js': 'export function sayHi(name) {\n  return "Hi " + name\n}\n',
      'main.js': 'import { sayHi } from "./greet.js"\nconsole.log(sayHi("world"))\n',
    },
    prompt:
      'Rename the function sayHi to greet across greet.js and main.js (definition and all call sites).',
    verify: async (d) => {
      const g = await read(d, 'greet.js')
      const m = await read(d, 'main.js')
      return /export function greet/.test(g) && /greet\(/.test(m) && !/sayHi/.test(g + m)
    },
  },
]
