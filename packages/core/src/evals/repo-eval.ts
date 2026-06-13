import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentLoop } from '../loop/loop'
import { ProviderClient } from '../provider/client'
import { ModelRegistry } from '../provider/models'
import { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { ToolRegistry } from '../tools/registry'
import { cost as tokenCost } from '../meter/cost'
import { createShell } from '../platform/shell'
import { buildRepoDigest } from '../repo/digest'
import { buildRepoFixture, REPO_CASES, type RepoEvalCase } from './repo-cases'

/**
 * 全库 vs 检索 comparison (出口指标): the same behavior-named tasks run
 * once with plain search tools and once with the whole repo pre-digested into
 * the semi-stable layer. Measures what repo mode actually buys: fewer rounds,
 * zero retrieval calls, and near-total cache hits after the first request.
 */

export type RepoEvalMode = 'search' | 'repo'

export interface RepoCaseResult {
  name: string
  mode: RepoEvalMode
  pass: boolean
  cost: number
  /** API requests in the loop (rounds). */
  requests: number
  /** read_file + grep + glob calls — what repo mode claims to eliminate. */
  retrievalCalls: number
  /** Aggregate hit/(hit+miss) over requests 2..n (acceptance: ≥95% in repo mode). */
  hitRateFrom2: number
  error?: string
}

export interface RepoComparisonReport {
  search: RepoCaseResult[]
  repo: RepoCaseResult[]
  digestTokens: number
  digestFiles: number
}

const RETRIEVAL_TOOLS = new Set(['read_file', 'grep', 'glob'])

export async function runRepoCase(
  c: RepoEvalCase,
  mode: RepoEvalMode,
  opts: { apiKey: string; baseUrl?: string }
): Promise<RepoCaseResult> {
  const dir = mkdtempSync(join(tmpdir(), `vibeseek-repoeval-`))
  const model = 'deepseek-v4-flash'
  const pricing = new ModelRegistry().get(model).pricing
  let cost = 0
  let requests = 0
  let retrievalCalls = 0
  let hit2 = 0
  let miss2 = 0

  try {
    for (const [path, content] of Object.entries(buildRepoFixture())) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content, 'utf8')
    }

    // Same shapes agent-service builds: search mode gets a one-line project
    // note; repo mode gets the digest in the semi-stable layer (frozen, cached).
    const digest = buildRepoDigest(dir)
    const contextMessage =
      mode === 'repo'
        ? `=== Full-repo mode: below is the entire source of this project (${digest.fileCount} files). It is already in context — do not grep or re-read files; answer and edit based on this directly. ===\n${digest.text}`
        : `Project root: a JavaScript codebase under src/.`

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
      model,
      thinking: 'off',
      maxIterations: 15,
    })

    for await (const ev of loop.run(c.prompt)) {
      if (ev.type === 'usage') {
        requests++
        cost += tokenCost(ev.usage, pricing)
        if (requests >= 2) {
          hit2 += ev.usage.cacheHitTokens
          miss2 += ev.usage.cacheMissTokens
        }
      } else if (ev.type === 'tool_end' && RETRIEVAL_TOOLS.has(ev.name)) {
        retrievalCalls++
      }
    }

    return {
      name: c.name,
      mode,
      pass: await c.verify(dir),
      cost,
      requests,
      retrievalCalls,
      hitRateFrom2: hit2 + miss2 > 0 ? hit2 / (hit2 + miss2) : 0,
    }
  } catch (e) {
    return {
      name: c.name,
      mode,
      pass: false,
      cost,
      requests,
      retrievalCalls,
      hitRateFrom2: hit2 + miss2 > 0 ? hit2 / (hit2 + miss2) : 0,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export async function runRepoComparison(opts: {
  apiKey: string
  baseUrl?: string
}): Promise<RepoComparisonReport> {
  const search: RepoCaseResult[] = []
  const repo: RepoCaseResult[] = []
  // search first so repo's digest-prefix warm-up can't help the search column.
  for (const c of REPO_CASES) search.push(await runRepoCase(c, 'search', opts))
  for (const c of REPO_CASES) repo.push(await runRepoCase(c, 'repo', opts))
  const sizeDir = mkFixtureDir()
  const digest = buildRepoDigest(sizeDir)
  rmSync(sizeDir, { recursive: true, force: true })
  return { search, repo, digestTokens: digest.tokenEstimate, digestFiles: digest.fileCount }
}

/** Materialize the fixture once more just to size the digest for the report. */
function mkFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vibeseek-repoeval-size-'))
  for (const [path, content] of Object.entries(buildRepoFixture())) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content, 'utf8')
  }
  return dir
}

const sum = (rows: RepoCaseResult[], f: (r: RepoCaseResult) => number): number =>
  rows.reduce((s, r) => s + f(r), 0)

export function formatRepoComparison(r: RepoComparisonReport): string {
  const col = (label: string, rows: RepoCaseResult[]): string => {
    const passed = rows.filter((x) => x.pass).length
    const hits = rows.map((x) => `${(x.hitRateFrom2 * 100).toFixed(0)}%`).join('/')
    return (
      `  ${label.padEnd(7)} ${passed}/${rows.length} pass  ` +
      `¥${sum(rows, (x) => x.cost).toFixed(4)}  ` +
      `requests=${sum(rows, (x) => x.requests)}  ` +
      `retrieval-calls=${sum(rows, (x) => x.retrievalCalls)}  ` +
      `hit(turn2+)=${hits}`
    )
  }
  return [
    `全库 vs 检索 — ${r.digestFiles} files / ~${Math.round(r.digestTokens / 1000)}K tokens digest`,
    col('search', r.search),
    col('repo', r.repo),
    ...r.search
      .concat(r.repo)
      .filter((x) => x.error)
      .map((x) => `  ! ${x.mode}/${x.name}: ${x.error}`),
  ].join('\n')
}
