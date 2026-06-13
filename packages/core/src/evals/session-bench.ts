import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AgentLoop } from '../loop/loop'
import { ProviderClient } from '../provider/client'
import { ModelRegistry } from '../provider/models'
import { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { ToolRegistry } from '../tools/registry'
import { cost as tokenCost } from '../meter/cost'
import { createShell } from '../platform/shell'

/**
 * Long-session bench. ONE conversation, many sequential edits in the
 * same growing project — the real daily-use pattern. Measures how the cache
 * hit rate CLIMBS turn over turn as the stable history dominates, vs the
 * diluted figure you get from independent one-shot tasks. Reuses a single
 * SessionContext across tasks (append-only), like the app does.
 */

const FLASH = 'deepseek-v4-flash'

interface Step {
  prompt: string
  /** Verify against the accumulated project dir after this step. */
  verify: (dir: string) => Promise<boolean>
}

const read = (dir: string, f: string): string => {
  try {
    return readFileSync(join(dir, f), 'utf8')
  } catch {
    return ''
  }
}

/** A realistic build-up: keep adding to one growing utils module. */
const STEPS: Step[] = [
  {
    prompt: 'Create src/utils.js with an exported add(a, b) that returns a + b.',
    verify: async (d) => /export function add|export const add/.test(read(d, 'src/utils.js')),
  },
  {
    prompt: 'Add an exported sub(a, b) to src/utils.js returning a - b.',
    verify: async (d) => /sub/.test(read(d, 'src/utils.js')),
  },
  {
    prompt: 'Add an exported mul(a, b) to src/utils.js.',
    verify: async (d) => /mul/.test(read(d, 'src/utils.js')),
  },
  {
    prompt: 'Add an exported clamp(v, lo, hi) to src/utils.js bounded to [lo, hi].',
    verify: async (d) => /clamp/.test(read(d, 'src/utils.js')),
  },
  {
    prompt: 'Add an exported sum(arr) to src/utils.js that totals an array of numbers.',
    verify: async (d) => /sum/.test(read(d, 'src/utils.js')),
  },
  {
    prompt: 'Add an exported avg(arr) to src/utils.js using sum; return 0 for empty.',
    verify: async (d) => /avg/.test(read(d, 'src/utils.js')),
  },
  {
    prompt: 'Add an exported clampAll(arr, lo, hi) to src/utils.js mapping clamp over arr.',
    verify: async (d) => /clampAll/.test(read(d, 'src/utils.js')),
  },
  {
    prompt: 'Add an exported isEmpty(arr) to src/utils.js returning arr.length === 0.',
    verify: async (d) => /isEmpty/.test(read(d, 'src/utils.js')),
  },
  {
    prompt: 'Add an exported last(arr) to src/utils.js returning the final element.',
    verify: async (d) => /last/.test(read(d, 'src/utils.js')),
  },
  {
    prompt: 'Add an exported first(arr) to src/utils.js returning the first element.',
    verify: async (d) => /first/.test(read(d, 'src/utils.js')),
  },
]

export interface SessionTurn {
  step: number
  pass: boolean
  /** Cumulative hit rate of the session up to and including this step. */
  cumulativeHitRate: number
  /** This step's own hit rate. */
  stepHitRate: number
  cost: number
}

export interface SessionBenchReport {
  model: string
  turns: SessionTurn[]
  finalCumulativeHitRate: number
  totalCost: number
  passRate: number
}

export async function runSessionBench(opts: {
  apiKey: string
  baseUrl?: string
  model?: string
  onProgress?: (t: SessionTurn) => void
}): Promise<SessionBenchReport> {
  const model = opts.model ?? FLASH
  const pricing = new ModelRegistry().get(model).pricing
  const dir = mkdtempSync(join(process.cwd(), '.eval-tmp-'))
  mkdirSync(join(dir, 'src'), { recursive: true })

  const registry = new ToolRegistry()
  // ONE context for the whole session — history accumulates (append-only).
  const context = new SessionContext({
    systemPrompt: SYSTEM_PROMPT,
    tools: registry.defs(),
    contextMessage: 'A small JS utility project under src/. We build it up step by step.',
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
    maxIterations: 8,
  })

  const turns: SessionTurn[] = []
  let cumHit = 0
  let cumMiss = 0
  let totalCost = 0
  try {
    for (let i = 0; i < STEPS.length; i++) {
      let stepHit = 0
      let stepMiss = 0
      let stepCost = 0
      for await (const ev of loop.run(STEPS[i].prompt)) {
        if (ev.type === 'usage') {
          stepHit += ev.usage.cacheHitTokens
          stepMiss += ev.usage.cacheMissTokens
          stepCost += tokenCost(ev.usage, pricing)
        }
      }
      cumHit += stepHit
      cumMiss += stepMiss
      totalCost += stepCost
      const turn: SessionTurn = {
        step: i + 1,
        pass: await STEPS[i].verify(dir),
        cumulativeHitRate: cumHit + cumMiss ? cumHit / (cumHit + cumMiss) : 0,
        stepHitRate: stepHit + stepMiss ? stepHit / (stepHit + stepMiss) : 0,
        cost: stepCost,
      }
      turns.push(turn)
      opts.onProgress?.(turn)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  return {
    model,
    turns,
    finalCumulativeHitRate: cumHit + cumMiss ? cumHit / (cumHit + cumMiss) : 0,
    totalCost,
    passRate: turns.length ? turns.filter((t) => t.pass).length / turns.length : 0,
  }
}

export function formatSessionBench(r: SessionBenchReport): string {
  const pct = (n: number): string => `${(n * 100).toFixed(0)}%`
  const rows = r.turns.map(
    (t) =>
      `  step ${String(t.step).padStart(2)}  this=${pct(t.stepHitRate)}  cumulative=${pct(t.cumulativeHitRate)}  ${t.pass ? '✓' : '✗'}`
  )
  return [
    `Session-bench (${r.model.replace('deepseek-', '')}) — one growing conversation, ${r.turns.length} edits`,
    ...rows,
    `final cumulative hit rate: ${pct(r.finalCumulativeHitRate)}  ·  pass ${pct(r.passRate)}  ·  ¥${r.totalCost.toFixed(4)}`,
  ].join('\n')
}
