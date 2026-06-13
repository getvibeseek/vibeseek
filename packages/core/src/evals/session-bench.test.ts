import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runSessionBench, formatSessionBench } from './session-bench'

// Long-session hit-rate climb. Real API, gated:
//   DEEPSEEK_EVAL_KEY=sk-... pnpm -F @vibeseek/core test -t "session-bench"
const key = process.env.DEEPSEEK_EVAL_KEY

describe('session-bench', () => {
  it.skipIf(!key)(
    'cache hit rate climbs across a growing conversation',
    async () => {
      const report = await runSessionBench({
        apiKey: key!,
        onProgress: (t) => {
          console.log(
            `[session step ${t.step}] this=${(t.stepHitRate * 100).toFixed(0)}% cum=${(t.cumulativeHitRate * 100).toFixed(0)}% ${t.pass ? 'PASS' : 'FAIL'}`
          )
        },
      })
      console.log('\n' + formatSessionBench(report) + '\n')
      writeFileSync(
        join(process.cwd(), 'evals-session-bench.json'),
        JSON.stringify(report, null, 2)
      )
      expect(report.turns.length).toBeGreaterThan(0)
    },
    1_200_000
  )
})
