import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { CASES_HARD } from './cases-hard'

/** Harness sanity (no API): correct solution PASSES, untouched fixture FAILS. */
const SOLUTIONS: Record<string, Record<string, string>> = {
  'hard-parse-duration': {
    'm.mjs':
      'export function parseDuration(s){if(typeof s!=="string"||!s)return null;const m=/^(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?$/.exec(s);if(!m||(m[1]===undefined&&m[2]===undefined&&m[3]===undefined))return null;return (+(m[1]||0))*3600+(+(m[2]||0))*60+(+(m[3]||0))}\n',
  },
  'hard-csv-row': {
    'm.mjs':
      'export function toCsvRow(f){return f.map(x=>/[",\\n]/.test(x)?\'"\'+x.replaceAll(\'"\',\'""\')+\'"\':x).join(",")}\n',
  },
  'hard-paginate': {
    'm.mjs':
      'export function paginate(items,page,size){const totalPages=Math.max(1,Math.ceil(items.length/size));const p=Math.min(Math.max(1,page),totalPages);return{items:items.slice((p-1)*size,p*size),page:p,totalPages}}\n',
  },
  'hard-email': {
    'm.mjs':
      'export function validateEmail(s){return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$/.test(s)}\n',
  },
  'hard-multifile-pipeline': {
    'parse.mjs':
      'export function parse(s){return s.split(",").map(x=>x.trim()).filter(x=>x.length)}\n',
    'transform.mjs':
      'import { parse } from "./parse.mjs"\nexport function toUpper(s){return parse(s).map(x=>x.toUpperCase())}\n',
    'index.mjs':
      'import { toUpper } from "./transform.mjs"\nexport function run(s){return toUpper(s).join("|")}\n',
  },
  'hard-statemachine': {
    'm.mjs':
      'export function nextLight(c){return c==="green"?"yellow":c==="yellow"?"red":c==="red"?"green":"red"}\n',
  },
  'hard-deepget': {
    'm.mjs':
      'export function get(obj,path,fallback){let cur=obj;for(const k of path.split(".")){if(cur==null||!(k in cur))return fallback;cur=cur[k]}return cur}\n',
  },
  'hard-romans': {
    'm.mjs':
      'const M=[[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]]\nexport function toRoman(n){let o="";for(const [v,s] of M){while(n>=v){o+=s;n-=v}}return o}\n',
  },
}

let dir: string
beforeEach(() => (dir = mkdtempSync(join(process.cwd(), '.eval-tmp-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))
const write = (files: Record<string, string>): void => {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true })
    writeFileSync(join(dir, p), c, 'utf8')
  }
}

describe('cases-hard harness sanity', () => {
  for (const c of CASES_HARD) {
    it(`${c.name}: correct solution passes`, async () => {
      expect(SOLUTIONS[c.name], `missing solution for ${c.name}`).toBeTruthy()
      write(SOLUTIONS[c.name])
      expect(await c.verify(dir)).toBe(true)
    })
    it(`${c.name}: untouched fixture fails`, async () => {
      write(c.files)
      expect(await c.verify(dir)).toBe(false)
    })
  }
})
