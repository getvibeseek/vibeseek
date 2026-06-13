import { describe, it, expect } from 'vitest'
import { makeSubagentTool, DISPATCH_SUBAGENT } from './subagent'

describe('makeSubagentTool', () => {
  const ctx = { cwd: '.', shell: {} as never }

  it('passes the task to the runner and returns its summary', async () => {
    let got = ''
    const tool = makeSubagentTool(async (task) => {
      got = task
      return 'found 3 TODOs'
    })
    expect(tool.def.name).toBe(DISPATCH_SUBAGENT)
    const res = await tool.run({ task: 'find TODOs' }, ctx)
    expect(got).toBe('find TODOs')
    expect(res.content).toBe('found 3 TODOs')
    expect(res.isError).toBeUndefined()
  })

  it('errors on empty task and surfaces runner failures', async () => {
    const okTool = makeSubagentTool(async () => 'x')
    expect((await okTool.run({ task: '  ' }, ctx)).isError).toBe(true)

    const boom = makeSubagentTool(async () => {
      throw new Error('nope')
    })
    const res = await boom.run({ task: 'go' }, ctx)
    expect(res.isError).toBe(true)
    expect(res.content).toContain('nope')
  })
})
