import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runBench, formatBench, pickCases } from './bench'

// 放开规模评测. Real API, gated:
//   DEEPSEEK_EVAL_KEY=sk-... BENCH_REPEATS=2 pnpm -F @vibeseek/core test -t "bench v1"
const key = process.env.DEEPSEEK_EVAL_KEY
const repeats = Number(process.env.BENCH_REPEATS ?? 2)

describe('bench v1', () => {
  it.skipIf(!key)(
    'runs the v1 set across auto/flash/pro and archives the report',
    async () => {
      const report = await runBench({
        apiKey: key!,
        repeats,
        cases: pickCases(process.env.BENCH_SET),
        onProgress: (done, total, last) => {
          console.log(
            `[bench ${done}/${total}] ${last.column}/${last.name}: ${last.pass ? 'PASS' : 'FAIL'} ¥${last.cost.toFixed(4)}`
          )
        },
      })

      console.log('\n' + formatBench(report) + '\n')
      writeFileSync(join(process.cwd(), 'evals-bench-v1.json'), JSON.stringify(report, null, 2))
      expect(report.results.length).toBeGreaterThan(0)
    },
    // 24 cases × 3 cols × 2 repeats × up-to-15 rounds — give it room.
    3_600_000
  )
})
