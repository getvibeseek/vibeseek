import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentLoop } from '../loop/loop'
import { ProviderClient } from '../provider/client'
import { ModelRegistry } from '../provider/models'
import { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { ToolRegistry } from '../tools/registry'
import { HitRateAccumulator } from '../meter/hit-rate'
import { cost as tokenCost } from '../meter/cost'
import { createShell } from '../platform/shell'
import { triageRoute } from '../router/triage'
import type { MatchLevel } from '../tools/edit'
import type { EvalCase } from './cases'

export interface CaseResult {
  name: string
  category: string
  pass: boolean
  cost: number
  hitRate: number
  turns: number
  editLevels: Record<MatchLevel, number>
  error?: string
}

export interface EvalReport {
  passRate: number
  passed: number
  total: number
  totalCost: number
  avgHitRate: number
  editLevels: Record<MatchLevel, number>
  cases: CaseResult[]
}

export interface RunOpts {
  apiKey: string
  baseUrl?: string
  /** Fixed model, or 'auto' to route each case via triage. */
  model?: string
  maxIterations?: number
}

export async function runCase(c: EvalCase, opts: RunOpts): Promise<CaseResult> {
  const dir = mkdtempSync(join(tmpdir(), `vibeseek-eval-${c.name}-`))
  const registry0 = new ModelRegistry()
  const acc = new HitRateAccumulator()
  let cost = 0
  let turns = 0
  const editLevels: Record<MatchLevel, number> = { exact: 0, tolerant: 0, failed: 0 }

  try {
    for (const [path, content] of Object.entries(c.files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content, 'utf8')
    }

    const client = new ProviderClient({
      baseUrl: opts.baseUrl ?? 'https://api.deepseek.com',
      apiKey: opts.apiKey,
    })

    // 'auto' routes through triage (the column under test); fixed models run as-is.
    let model = opts.model ?? 'deepseek-v4-flash'
    let thinking: 'off' | 'high' | 'max' = 'off'
    if (model === 'auto') {
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
      maxIterations: opts.maxIterations ?? 15,
    })

    for await (const ev of loop.run(c.prompt)) {
      if (ev.type === 'usage') {
        acc.add(ev.usage)
        cost += tokenCost(ev.usage, pricing)
        turns++
      } else if (ev.type === 'tool_end' && ev.name === 'edit_file') {
        const level = ev.result.meta?.matchLevel as MatchLevel | undefined
        if (level) editLevels[level]++
      }
    }

    const pass = await c.verify(dir)
    return {
      name: c.name,
      category: c.category,
      pass,
      cost,
      hitRate: acc.rate,
      turns,
      editLevels,
    }
  } catch (e) {
    return {
      name: c.name,
      category: c.category,
      pass: false,
      cost,
      hitRate: acc.rate,
      turns,
      editLevels,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function runAll(cases: EvalCase[], opts: RunOpts): Promise<EvalReport> {
  const results: CaseResult[] = []
  for (const c of cases) results.push(await runCase(c, opts))

  const passed = results.filter((r) => r.pass).length
  const editLevels: Record<MatchLevel, number> = { exact: 0, tolerant: 0, failed: 0 }
  for (const r of results) {
    editLevels.exact += r.editLevels.exact
    editLevels.tolerant += r.editLevels.tolerant
    editLevels.failed += r.editLevels.failed
  }
  return {
    passRate: results.length ? passed / results.length : 0,
    passed,
    total: results.length,
    totalCost: results.reduce((s, r) => s + r.cost, 0),
    avgHitRate: results.length ? results.reduce((s, r) => s + r.hitRate, 0) / results.length : 0,
    editLevels,
    cases: results,
  }
}

/** Three-column comparison: auto-routing vs pure-flash vs pure-pro. */
export interface ComparisonReport {
  auto: EvalReport
  flash: EvalReport
  pro: EvalReport
  /** auto cost as a fraction saved vs pure-pro (1 - autoCost/proCost). */
  savedVsPro: number
}

export async function runComparison(
  cases: EvalCase[],
  opts: { apiKey: string; baseUrl?: string }
): Promise<ComparisonReport> {
  const base = { apiKey: opts.apiKey, baseUrl: opts.baseUrl }
  // Pure-pro first warms the shared prefix cache; flash & auto then run honestly
  // against the same cache state (cross-model prefix sharing).
  const pro = await runAll(cases, { ...base, model: 'deepseek-v4-pro' })
  const flash = await runAll(cases, { ...base, model: 'deepseek-v4-flash' })
  const auto = await runAll(cases, { ...base, model: 'auto' })
  const savedVsPro = pro.totalCost > 0 ? 1 - auto.totalCost / pro.totalCost : 0
  return { auto, flash, pro, savedVsPro }
}

export function formatComparison(r: ComparisonReport): string {
  const row = (label: string, rep: EvalReport): string =>
    `  ${label.padEnd(7)} ${rep.passed}/${rep.total} pass (${(rep.passRate * 100).toFixed(0)}%)`.padEnd(
      34
    ) + `¥${rep.totalCost.toFixed(4)}  hit=${(rep.avgHitRate * 100).toFixed(0)}%`
  return [
    'Eval v0 三列对比 — auto vs flash vs pro',
    row('auto', r.auto),
    row('flash', r.flash),
    row('pro', r.pro),
    '',
    `auto 相对纯 pro 省 ${(r.savedVsPro * 100).toFixed(0)}% 费用，通过率 ${(r.auto.passRate * 100).toFixed(0)}% vs pro ${(r.pro.passRate * 100).toFixed(0)}%`,
  ].join('\n')
}

export function formatReport(report: EvalReport): string {
  const lines = [
    `Eval v0 — ${report.passed}/${report.total} passed (${(report.passRate * 100).toFixed(0)}%)`,
    `Total cost: ¥${report.totalCost.toFixed(4)} · avg hit rate: ${(report.avgHitRate * 100).toFixed(0)}%`,
    `Edit levels: exact=${report.editLevels.exact} tolerant=${report.editLevels.tolerant} failed=${report.editLevels.failed}`,
    '',
    ...report.cases.map(
      (r) =>
        `  ${r.pass ? '✓' : '✗'} ${r.name.padEnd(20)} ${r.category.padEnd(9)} ` +
        `¥${r.cost.toFixed(4)} hit=${(r.hitRate * 100).toFixed(0)}% turns=${r.turns}` +
        (r.error ? ` ERROR: ${r.error}` : '')
    ),
  ]
  return lines.join('\n')
}
