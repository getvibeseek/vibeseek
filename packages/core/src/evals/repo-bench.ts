import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AgentLoop } from '../loop/loop'
import { ProviderClient } from '../provider/client'
import { ModelRegistry } from '../provider/models'
import { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { ToolRegistry } from '../tools/registry'
import { cost as tokenCost } from '../meter/cost'
import { createShell } from '../platform/shell'
import { buildRepoDigest } from '../repo/digest'

/**
 * Heavy whole-repo benchmark (layer C). A LARGE synthetic project (~N
 * filler modules pushing the digest toward the 300K budget) with planted
 * targets named only by BEHAVIOR. Run in full-repo mode on pro — the big
 * first-turn cache MISS on the digest is the dominant cost, and it stresses
 * the flagship feature at realistic scale. Executable verification.
 */

const PRO = 'deepseek-v4-pro'
const FLASH = 'deepseek-v4-flash'

interface Planted {
  file: string
  content: string
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
const fnOf = (m: Record<string, unknown> | null, n: string): ((...a: never[]) => unknown) | null =>
  m && typeof m[n] === 'function' ? (m[n] as (...a: never[]) => unknown) : null

/** One filler module — plausible, deterministic, a few KB each. */
function filler(area: string, i: number): string {
  const lines: string[] = [`// ${area} module ${i} — internal helpers`]
  for (let k = 0; k < 14; k++) {
    lines.push(
      `export function ${area}_${i}_op${k}(input) {`,
      `  const v = String(input ?? '').trim()`,
      `  if (!v) return { area: '${area}', mod: ${i}, op: ${k}, ok: false }`,
      `  const score = v.length * ${k + 1} + ${i}`,
      `  return { area: '${area}', mod: ${i}, op: ${k}, ok: true, score }`,
      `}`,
      ``
    )
  }
  return lines.join('\n')
}

/** Three behavior-named targets buried in the project. */
const PLANTED: Planted[] = [
  {
    file: 'src/billing/totals.mjs',
    content: [
      '// Order settlement.',
      'const TAX = 0.13',
      'export function orderTotal(subtotal, discount) {',
      '  const taxed = subtotal * (1 + TAX)',
      '  return taxed - discount', // bug: discount after tax
      '}',
      '',
    ].join('\n'),
    prompt:
      'Somewhere in this project the order total applies the discount AFTER tax. It must subtract the discount from the subtotal BEFORE tax. Find it and fix it.',
    verify: async (d) => {
      const f = fnOf(await load(d, 'src/billing/totals.mjs'), 'orderTotal')
      // (100 - 10) * 1.13 = 101.7  (correct)  vs  100*1.13 - 10 = 103 (buggy)
      return !!f && Math.abs((f(100 as never, 10 as never) as number) - 101.7) < 1e-6
    },
  },
  {
    file: 'src/net/retry.mjs',
    content: [
      '// Outbound HTTP retry.',
      'const MAX_ATTEMPTS = 3',
      'export function attempts() {',
      '  return MAX_ATTEMPTS',
      '}',
      '',
    ].join('\n'),
    prompt: 'Increase the HTTP retry attempts in this project from 3 to 5.',
    verify: async (d) => {
      const f = fnOf(await load(d, 'src/net/retry.mjs'), 'attempts')
      return !!f && f() === 5
    },
  },
  {
    file: 'src/text/dates.mjs',
    content: [
      '// Date/time helpers.',
      'export function formatDate(ts) {',
      '  return new Date(ts).toISOString().slice(0, 10)',
      '}',
      '',
    ].join('\n'),
    prompt:
      'Add an exported formatDuration(ms) to the module that already holds the date/time formatting helpers. 90061000 ms → "25h 1m 1s".',
    verify: async (d) => {
      const f = fnOf(await load(d, 'src/text/dates.mjs'), 'formatDuration')
      return !!f && f(90061000 as never) === '25h 1m 1s'
    },
  },
]

/** Materialize the big project; returns its dir. `fillers` tunes digest size. */
function buildProject(fillers: number): string {
  const dir = mkdtempSync(join(process.cwd(), '.eval-tmp-'))
  const areas = ['auth', 'store', 'ui', 'queue', 'log', 'sync', 'parse', 'render']
  let made = 0
  for (let i = 0; made < fillers; i++) {
    for (const area of areas) {
      if (made >= fillers) break
      const p = join(dir, 'src', area, `${area}-${i}.mjs`)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, filler(area, i), 'utf8')
      made++
    }
  }
  for (const t of PLANTED) {
    const p = join(dir, t.file)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, t.content, 'utf8')
  }
  return dir
}

export interface RepoRunResult {
  task: string
  model: string
  repoMode: boolean
  pass: boolean
  cost: number
  requests: number
  retrievalCalls: number
  hitRate: number
  digestTokens: number
  error?: string
}

const RETRIEVAL = new Set(['read_file', 'grep', 'glob'])

async function runRepoTask(
  t: Planted,
  opts: {
    apiKey: string
    baseUrl?: string
    model: string
    repoMode: boolean
    fillers: number
    /** Unique nonce → forces a cold cache miss, simulating a brand-new project
     *  (every user opening every new repo pays this first-turn cost). Omit to
     *  measure the warm-cache / return-visit path instead. */
    salt?: string
  }
): Promise<RepoRunResult> {
  const dir = buildProject(opts.fillers)
  const pricing = new ModelRegistry().get(opts.model).pricing
  let cost = 0
  let requests = 0
  let retrievalCalls = 0
  let hit = 0
  let miss = 0
  let digestTokens = 0
  try {
    const digest = buildRepoDigest(dir)
    digestTokens = digest.tokenEstimate
    const nonce = opts.salt ? `[project ${opts.salt}]\n` : ''
    const contextMessage = opts.repoMode
      ? `${nonce}=== Full-repo mode: the entire source of this project (${digest.fileCount} files) is below. Do not grep/re-read to find things; answer and edit from it directly. ===\n${digest.text}`
      : `${nonce}Project root: a JavaScript codebase under src/.`
    const registry = new ToolRegistry()
    const context = new SessionContext({
      systemPrompt: SYSTEM_PROMPT,
      tools: registry.defs(),
      contextMessage,
    })
    const loop = new AgentLoop({
      streamer: new ProviderClient({
        baseUrl: opts.baseUrl ?? 'https://api.deepseek.com',
        apiKey: opts.apiKey,
      }),
      registry,
      context,
      toolContext: { cwd: dir, shell: createShell() },
      model: opts.model,
      thinking: 'high',
      maxIterations: 20,
    })
    for await (const ev of loop.run(t.prompt)) {
      if (ev.type === 'usage') {
        cost += tokenCost(ev.usage, pricing)
        requests++
        hit += ev.usage.cacheHitTokens
        miss += ev.usage.cacheMissTokens
      } else if (ev.type === 'tool_end' && RETRIEVAL.has(ev.name)) {
        retrievalCalls++
      }
    }
    return {
      task: t.file,
      model: opts.model,
      repoMode: opts.repoMode,
      pass: await t.verify(dir),
      cost,
      requests,
      retrievalCalls,
      hitRate: hit + miss ? hit / (hit + miss) : 0,
      digestTokens,
    }
  } catch (e) {
    return {
      task: t.file,
      model: opts.model,
      repoMode: opts.repoMode,
      pass: false,
      cost,
      requests,
      retrievalCalls,
      hitRate: hit + miss ? hit / (hit + miss) : 0,
      digestTokens,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface RepoBenchReport {
  results: RepoRunResult[]
  totalCost: number
  digestTokens: number
  passRate: number
}

/** Heavy run: every planted target × {repo, search} × pro, repeated. */
export async function runRepoBench(opts: {
  apiKey: string
  baseUrl?: string
  repeats?: number
  fillers?: number
  proOnly?: boolean
  /** Cold mode: each task gets a unique salt → every digest is a fresh miss
   *  (real first-open cost). Off = warm cache (return-visit cost). */
  cold?: boolean
  onProgress?: (done: number, total: number, last: RepoRunResult) => void
}): Promise<RepoBenchReport> {
  const repeats = opts.repeats ?? 2
  const fillers = opts.fillers ?? 80
  const models = opts.proOnly ? [PRO] : [PRO, FLASH]
  const results: RepoRunResult[] = []
  const total = PLANTED.length * 2 * models.length * repeats
  let done = 0
  // Per-PROCESS seed: without it the salt repeats verbatim across runs, so a
  // second batch HITS the first batch's server-side cache (looked warm at
  // ¥0.015/task). Seeding makes every batch a genuine cold miss.
  const runSeed = Math.floor(Math.random() * 1e9).toString(36)
  for (const model of models) {
    for (const repoMode of [true, false]) {
      for (let r = 0; r < repeats; r++) {
        for (const t of PLANTED) {
          const salt = opts.cold ? `${runSeed}-${model}-${r}-${t.file}-${done}` : undefined
          const res = await runRepoTask(t, { ...opts, model, repoMode, fillers, salt })
          results.push(res)
          done++
          opts.onProgress?.(done, total, res)
        }
      }
    }
  }
  const totalCost = results.reduce((s, r) => s + r.cost, 0)
  const passRate = results.length ? results.filter((r) => r.pass).length / results.length : 0
  const digestTokens = results[0]?.digestTokens ?? 0
  return { results, totalCost, digestTokens, passRate }
}

export function formatRepoBench(r: RepoBenchReport): string {
  const pct = (n: number): string => `${(n * 100).toFixed(0)}%`
  const group = (repoMode: boolean): string => {
    const rows = r.results.filter((x) => x.repoMode === repoMode)
    const pass = rows.filter((x) => x.pass).length
    const calls = rows.reduce((s, x) => s + x.retrievalCalls, 0)
    const cost = rows.reduce((s, x) => s + x.cost, 0)
    const hit = rows.length ? rows.reduce((s, x) => s + x.hitRate, 0) / rows.length : 0
    return `  ${repoMode ? 'repo  ' : 'search'} ${pass}/${rows.length} pass  ¥${cost.toFixed(4)}  retrieval-calls=${calls}  avgHit=${pct(hit)}`
  }
  return [
    `Repo-bench (heavy) — ~${Math.round(r.digestTokens / 1000)}K-token digest, total ¥${r.totalCost.toFixed(2)}`,
    group(true),
    group(false),
  ].join('\n')
}
