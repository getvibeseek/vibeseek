import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runRepoComparison, formatRepoComparison } from './repo-eval'

// 出口指标: 全库 vs 检索, real API, gated like the other evals:
//   DEEPSEEK_EVAL_KEY=sk-... pnpm -F @vibeseek/core test -t 全库
const key = process.env.DEEPSEEK_EVAL_KEY

describe('全库 vs 检索 comparison', () => {
  it.skipIf(!key)(
    'repo mode answers without retrieval and stays cache-hot',
    async () => {
      const report = await runRepoComparison({ apiKey: key! })
      console.log('\n' + formatRepoComparison(report) + '\n')
      writeFileSync(
        join(process.cwd(), 'evals-repo-comparison.json'),
        JSON.stringify(report, null, 2)
      )

      const passed = (rows: typeof report.repo): number => rows.filter((r) => r.pass).length
      // Quality must not regress with the whole repo in context.
      expect(passed(report.repo)).toBeGreaterThanOrEqual(passed(report.search))
      // The headline claim: retrieval tool calls collapse in repo mode.
      const calls = (rows: typeof report.repo): number =>
        rows.reduce((s, r) => s + r.retrievalCalls, 0)
      expect(calls(report.repo)).toBeLessThan(calls(report.search))
    },
    600_000
  )
})
