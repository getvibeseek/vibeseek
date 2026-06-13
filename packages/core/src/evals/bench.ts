import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { AgentLoop } from '../loop/loop'
import { ProviderClient } from '../provider/client'
import { ModelRegistry } from '../provider/models'
import { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { ToolRegistry } from '../tools/registry'
import { cost as tokenCost } from '../meter/cost'
import { createShell } from '../platform/shell'
import { triageRoute } from '../router/triage'
import { CASES_V1, type EvalCaseV1, type EvalCategory } from './cases-v1'
import { CASES_HARD } from './cases-hard'

/** Pick the case set: 'v1' (24 simple/short), 'hard' (8 edge-heavy), 'all'. */
export function pickCases(set: string | undefined): EvalCaseV1[] {
  if (set === 'hard') return CASES_HARD
  if (set === 'all') return [...CASES_V1, ...CASES_HARD]
  return CASES_V1
}

/**
 * Benchmark harness (放开规模). Runs the v1 set under three columns —
 * auto / flash / pro — each repeated N times, and aggregates pass rate, cost,
 * hit rate and per-category breakdown. Executable verification (import & run)
 * keeps the pass rate honest. In-root temp dirs because vite-node refuses to
 * import fixtures outside the project root.
 */

export type Column = 'auto' | 'flash' | 'pro'

const FLASH = 'deepseek-v4-flash'
const PRO = 'deepseek-v4-pro'

export interface RunResult {
  name: string
  category: EvalCategory
  column: Column
  pass: boolean
  cost: number
  requests: number
  hit: number
  miss: number
  error?: string
}

async function runOne(
  c: EvalCaseV1,
  column: Column,
  opts: { apiKey: string; baseUrl?: string }
): Promise<RunResult> {
  const dir = mkdtempSync(join(process.cwd(), '.eval-tmp-'))
  const registry0 = new ModelRegistry()
  let cost = 0
  let requests = 0
  let hit = 0
  let miss = 0
  try {
    for (const [path, content] of Object.entries(c.files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content, 'utf8')
    }
    const client = new ProviderClient({
      baseUrl: opts.baseUrl ?? 'https://api.deepseek.com',
      apiKey: opts.apiKey,
    })

    let model = column === 'pro' ? PRO : FLASH
    let thinking: 'off' | 'high' | 'max' = 'high'
    if (column === 'auto') {
      const route = await triageRoute(client, c.prompt)
      model = route.model
      thinking = route.thinking
    }
    const pricing = registry0.get(model).pricing

    const registry = new ToolRegistry()
    const context = new SessionContext({
      systemPrompt: SYSTEM_PROMPT,
      tools: registry.defs(),
      contextMessage: `Project files: ${Object.keys(c.files).join(', ')}`,
    })
    const loop = new AgentLoop({
      streamer: client,
      registry,
      context,
      toolContext: { cwd: dir, shell: createShell() },
      model,
      thinking,
      maxIterations: 15,
    })
    for await (const ev of loop.run(c.prompt)) {
      if (ev.type === 'usage') {
        cost += tokenCost(ev.usage, pricing)
        requests++
        hit += ev.usage.cacheHitTokens
        miss += ev.usage.cacheMissTokens
      }
    }
    return {
      name: c.name,
      category: c.category,
      column,
      pass: await c.verify(dir),
      cost,
      requests,
      hit,
      miss,
    }
  } catch (e) {
    return {
      name: c.name,
      category: c.category,
      column,
      pass: false,
      cost,
      requests,
      hit,
      miss,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface BenchReport {
  repeats: number
  total: number
  columns: Record<
    Column,
    {
      pass: number
      runs: number
      passRate: number
      cost: number
      hitRate: number
      byCategory: Record<string, { pass: number; runs: number }>
    }
  >
  savedVsProPct: number
  results: RunResult[]
}

export async function runBench(opts: {
  apiKey: string
  baseUrl?: string
  repeats?: number
  /** Subset of columns; default all three. */
  columns?: Column[]
  /** Which case set: 'v1' | 'hard' | 'all'. */
  cases?: EvalCaseV1[]
  onProgress?: (done: number, total: number, last: RunResult) => void
}): Promise<BenchReport> {
  const repeats = opts.repeats ?? 2
  const columns = opts.columns ?? (['pro', 'flash', 'auto'] as Column[])
  const cases = opts.cases ?? CASES_V1
  const results: RunResult[] = []
  const total = cases.length * columns.length * repeats
  let done = 0
  // pro first warms the shared prefix cache; flash/auto then run honestly.
  for (const column of columns) {
    for (let r = 0; r < repeats; r++) {
      for (const c of cases) {
        const res = await runOne(c, column, opts)
        results.push(res)
        done++
        opts.onProgress?.(done, total, res)
      }
    }
  }

  const mk = (): BenchReport['columns'][Column] => ({
    pass: 0,
    runs: 0,
    passRate: 0,
    cost: 0,
    hitRate: 0,
    byCategory: {},
  })
  const cols = { auto: mk(), flash: mk(), pro: mk() }
  const hitAcc: Record<Column, { hit: number; miss: number }> = {
    auto: { hit: 0, miss: 0 },
    flash: { hit: 0, miss: 0 },
    pro: { hit: 0, miss: 0 },
  }
  for (const r of results) {
    const col = cols[r.column]
    col.runs++
    col.cost += r.cost
    if (r.pass) col.pass++
    hitAcc[r.column].hit += r.hit
    hitAcc[r.column].miss += r.miss
    const cat = (col.byCategory[r.category] ??= { pass: 0, runs: 0 })
    cat.runs++
    if (r.pass) cat.pass++
  }
  for (const k of Object.keys(cols) as Column[]) {
    const col = cols[k]
    col.passRate = col.runs ? col.pass / col.runs : 0
    const h = hitAcc[k]
    col.hitRate = h.hit + h.miss ? h.hit / (h.hit + h.miss) : 0
  }
  const savedVsProPct = cols.pro.cost > 0 ? 1 - cols.auto.cost / cols.pro.cost : 0

  return { repeats, total: cases.length, columns: cols, savedVsProPct, results }
}

export function formatBench(r: BenchReport): string {
  const pct = (n: number): string => `${(n * 100).toFixed(0)}%`
  const line = (label: string, c: BenchReport['columns'][Column]): string =>
    `  ${label.padEnd(6)} ${c.pass}/${c.runs} (${pct(c.passRate)})  ¥${c.cost.toFixed(4)}  hit=${pct(c.hitRate)}`
  const cats = ['bugfix', 'feature', 'test', 'refactor']
  const catLine = (col: Column): string =>
    `  ${col.padEnd(6)} ` +
    cats
      .map((cat) => {
        const x = r.columns[col].byCategory[cat]
        return `${cat}:${x ? `${x.pass}/${x.runs}` : '-'}`
      })
      .join('  ')
  return [
    `Bench v1 — ${r.total} cases × ${r.repeats} repeats × 3 columns`,
    line('auto', r.columns.auto),
    line('flash', r.columns.flash),
    line('pro', r.columns.pro),
    '',
    'by category (pass/runs):',
    catLine('auto'),
    catLine('flash'),
    catLine('pro'),
    '',
    `auto vs pure-pro: ${pct(r.savedVsProPct)} cheaper, pass ${pct(r.columns.auto.passRate)} vs ${pct(r.columns.pro.passRate)}`,
  ].join('\n')
}
