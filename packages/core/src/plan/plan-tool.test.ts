import { describe, it, expect } from 'vitest'
import { makeUpdatePlanTool, type PlanItem } from './plan-tool'
import { createShell } from '../platform/shell'
import type { ToolContext } from '../tools/types'

const ctx: ToolContext = { cwd: '.', shell: createShell() }

describe('update_plan tool', () => {
  it('validates and forwards the full list', async () => {
    let got: PlanItem[] = []
    const tool = makeUpdatePlanTool((items) => (got = items))
    const res = await tool.run(
      {
        items: [
          { text: '读相关文件', status: 'done' },
          { text: '改实现', status: 'in_progress' },
          { text: '跑测试', status: 'pending' },
        ],
      },
      ctx
    )
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('1/3')
    expect(got).toHaveLength(3)
    expect(got[1]).toEqual({ text: '改实现', status: 'in_progress' })
  })

  it('rejects malformed items without firing the callback', async () => {
    let fired = false
    const tool = makeUpdatePlanTool(() => (fired = true))
    const res = await tool.run({ items: [{ text: '', status: 'weird' }] }, ctx)
    expect(res.isError).toBe(true)
    expect(fired).toBe(false)
  })
})
