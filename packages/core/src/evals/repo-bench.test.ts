import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runRepoBench, formatRepoBench } from './repo-bench'

// Layer C — heavy whole-repo bench. Real API, gated:
//   DEEPSEEK_EVAL_KEY=sk-... REPO_REPEATS=4 REPO_FILLERS=240 \
//     pnpm -F @vibeseek/core test -t "repo-bench heavy"
const key = process.env.DEEPSEEK_EVAL_KEY
const repeats = Number(process.env.REPO_REPEATS ?? 2)
const fillers = Number(process.env.REPO_FILLERS ?? 240)
const proOnly = process.env.REPO_PRO_ONLY !== '0'
const cold = process.env.REPO_COLD === '1'

describe('repo-bench heavy', () => {
  it.skipIf(!key)(
    'runs planted targets under full-repo vs search on a large digest',
    async () => {
      const report = await runRepoBench({
        apiKey: key!,
        repeats,
        fillers,
        proOnly,
        cold,
        onProgress: (done, total, last) => {
          console.log(
            `[repo ${done}/${total}] ${last.repoMode ? 'repo' : 'search'}/${last.model.replace('deepseek-', '')}/${last.task}: ${last.pass ? 'PASS' : 'FAIL'} ¥${last.cost.toFixed(3)} (digest ${Math.round(last.digestTokens / 1000)}K)`
          )
        },
      })
      console.log('\n' + formatRepoBench(report) + '\n')
      const stamp = Date.now()
      writeFileSync(
        join(process.cwd(), `evals-repo-bench-${stamp}.json`),
        JSON.stringify(report, null, 2)
      )
      expect(report.results.length).toBeGreaterThan(0)
    },
    7_200_000
  )
})
