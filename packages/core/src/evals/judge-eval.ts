import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { AgentLoop } from '../loop/loop'
import { ProviderClient } from '../provider/client'
import { ModelRegistry } from '../provider/models'
import { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { ToolRegistry } from '../tools/registry'
import { cost as tokenCost } from '../meter/cost'
import { createShell } from '../platform/shell'
import { completeOnce } from '../loop/complete-once'
import type { Message } from '../provider/types'
import { HARD_CASES, type HardCase } from './hard-cases'

/**
 * Goal+judge experiment (方案 backlog #1 — data BEFORE building the feature):
 * after the agent finishes, a flash judge reviews the task + resulting files
 * WITHOUT seeing the ground-truth checks. If it finds deficiencies, its
 * feedback goes back into the SAME conversation for one fix round. Ground
 * truth (executable verify) scores both arms.
 */

export interface JudgedCaseResult {
  name: string
  judged: boolean
  pass: boolean
  cost: number
  requests: number
  /** Judge said not-done and triggered a retry round. */
  retried: boolean
  /** Judge's verdict disagreed with ground truth (false alarm / miss). */
  judgeWrong: boolean
  error?: string
}

const MODEL = 'deepseek-v4-flash'

const judgePrompt = (task: string, files: string): string =>
  `You are a strict code reviewer. The task was:\n${task}\n\n` +
  `The resulting project files:\n${files}\n\n` +
  `Judge whether the implementation FULLY satisfies the task, including every edge case the ` +
  `task states. Reply with ONLY a JSON object: {"pass": true} or ` +
  `{"pass": false, "feedback": "<what is wrong or missing, concretely>"}.`

function snapshotFiles(dir: string): string {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    try {
      out.push(`=== ${name} ===\n${readFileSync(join(dir, name), 'utf8')}`)
    } catch {
      // subdirs/binaries irrelevant for these fixtures
    }
  }
  return out.join('\n')
}

export async function runJudgedCase(
  c: HardCase,
  judged: boolean,
  opts: { apiKey: string; baseUrl?: string }
): Promise<JudgedCaseResult> {
  // IN-ROOT temp dir: verify() dynamic-imports the produced .mjs, and
  // vite-node refuses imports from outside the project root.
  const dir = mkdtempSync(join(process.cwd(), '.eval-tmp-'))
  const pricing = new ModelRegistry().get(MODEL).pricing
  let cost = 0
  let requests = 0
  let retried = false

  try {
    for (const [path, content] of Object.entries(c.files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content, 'utf8')
    }
    const client = new ProviderClient({
      baseUrl: opts.baseUrl ?? 'https://api.deepseek.com',
      apiKey: opts.apiKey,
    })
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
      model: MODEL,
      thinking: 'off',
      maxIterations: 15,
    })

    const drain = async (prompt: string): Promise<void> => {
      for await (const ev of loop.run(prompt)) {
        if (ev.type === 'usage') {
          cost += tokenCost(ev.usage, pricing)
          requests++
        }
      }
    }

    await drain(c.prompt)

    let judgeSaidPass: boolean | null = null
    if (judged) {
      const messages: Message[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: judgePrompt(c.prompt, snapshotFiles(dir)) }],
        },
      ]
      const { text, usage } = await completeOnce(client, MODEL, messages)
      cost += tokenCost(usage, pricing)
      requests++
      const m = /\{[\s\S]*\}/.exec(text)
      let verdict: { pass?: boolean; feedback?: string } = {}
      try {
        verdict = m ? (JSON.parse(m[0]) as typeof verdict) : {}
      } catch {
        verdict = {}
      }
      judgeSaidPass = verdict.pass === true
      if (!judgeSaidPass) {
        retried = true
        await drain(
          `A reviewer checked your work and found it incomplete: ${verdict.feedback ?? 'edge cases not fully satisfied'}. Fix the implementation accordingly.`
        )
      }
    }

    const pass = await c.verify(dir)
    return {
      name: c.name,
      judged,
      pass,
      cost,
      requests,
      retried,
      // Only the immediate verdict is graded: a judge that approved a failing
      // result was wrong; post-retry outcomes aren't attributed to the judge.
      judgeWrong: judged && judgeSaidPass === true && !pass,
    }
  } catch (e) {
    return {
      name: c.name,
      judged,
      pass: false,
      cost,
      requests,
      retried,
      judgeWrong: false,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

export interface JudgeReport {
  baseline: JudgedCaseResult[]
  judged: JudgedCaseResult[]
}

export async function runJudgeComparison(opts: {
  apiKey: string
  baseUrl?: string
}): Promise<JudgeReport> {
  const baseline: JudgedCaseResult[] = []
  const judged: JudgedCaseResult[] = []
  for (const c of HARD_CASES) baseline.push(await runJudgedCase(c, false, opts))
  for (const c of HARD_CASES) judged.push(await runJudgedCase(c, true, opts))
  return { baseline, judged }
}

export function formatJudgeReport(r: JudgeReport): string {
  const col = (label: string, rows: JudgedCaseResult[]): string => {
    const passed = rows.filter((x) => x.pass).length
    const cost = rows.reduce((s, x) => s + x.cost, 0)
    const reqs = rows.reduce((s, x) => s + x.requests, 0)
    const retries = rows.filter((x) => x.retried).length
    return (
      `  ${label.padEnd(9)} ${passed}/${rows.length} pass  ¥${cost.toFixed(4)}  ` +
      `requests=${reqs}  retries=${retries}`
    )
  }
  const detail = (rows: JudgedCaseResult[]): string[] =>
    rows.map(
      (x) =>
        `    ${x.pass ? '✓' : '✗'} ${x.name.padEnd(16)} ¥${x.cost.toFixed(4)}` +
        (x.retried ? ' (judge→retry)' : '') +
        (x.error ? ` ERROR: ${x.error}` : '')
    )
  return [
    'goal+judge 实验 — 难例集，flash · think off',
    col('baseline', r.baseline),
    ...detail(r.baseline),
    col('judged', r.judged),
    ...detail(r.judged),
  ].join('\n')
}
