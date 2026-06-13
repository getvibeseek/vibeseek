import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CASES } from './cases'
import { runAll, formatReport, runComparison, formatComparison } from './harness'

// Real-API eval run. Gated on DEEPSEEK_EVAL_KEY. One command:
//   DEEPSEEK_EVAL_KEY=sk-... pnpm eval
const key = process.env.DEEPSEEK_EVAL_KEY

describe('eval set v0', () => {
  it.skipIf(!key)(
    'runs all cases and archives a baseline report',
    async () => {
      const report = await runAll(CASES, { apiKey: key! })
      const text = formatReport(report)
      console.log('\n' + text + '\n')
      // Archive the baseline into the repo for regression comparison.
      writeFileSync(join(process.cwd(), 'evals-report.json'), JSON.stringify(report, null, 2))

      expect(report.total).toBe(CASES.length)
      // v0 spirit: at least ~60% should pass for Flash to be viable on these tasks.
      expect(report.passed).toBeGreaterThanOrEqual(Math.ceil(CASES.length * 0.6))
    },
    300_000
  )

  // 出口指标:auto vs 纯flash vs 纯pro 三列对比，数据进 README 素材库。
  it.skipIf(!key)(
    'compares auto-routing against pure flash/pro',
    async () => {
      const report = await runComparison(CASES, { apiKey: key! })
      console.log('\n' + formatComparison(report) + '\n')
      writeFileSync(join(process.cwd(), 'evals-comparison.json'), JSON.stringify(report, null, 2))
      // Auto must not regress pass rate below pure-pro while costing less.
      expect(report.auto.passRate).toBeGreaterThanOrEqual(report.pro.passRate - 0.001)
      expect(report.auto.totalCost).toBeLessThanOrEqual(report.pro.totalCost)
    },
    600_000
  )
})
