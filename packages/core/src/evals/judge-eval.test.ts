import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runJudgeComparison, formatJudgeReport } from './judge-eval'

// Goal+judge experiment (方案 backlog #1), real API, gated:
//   DEEPSEEK_EVAL_KEY=sk-... pnpm -F @vibeseek/core test -t "goal+judge"
const key = process.env.DEEPSEEK_EVAL_KEY

describe('goal+judge experiment', () => {
  it.skipIf(!key)(
    'measures judge-retry lift vs baseline on hard cases',
    async () => {
      const report = await runJudgeComparison({ apiKey: key! })
      console.log('\n' + formatJudgeReport(report) + '\n')
      writeFileSync(
        join(process.cwd(), 'evals-judge-experiment.json'),
        JSON.stringify(report, null, 2)
      )
      // Data-gathering run: only sanity-assert it completed both arms.
      expect(report.baseline).toHaveLength(4)
      expect(report.judged).toHaveLength(4)
    },
    900_000
  )
})
