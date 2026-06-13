import { describe, it, expect } from 'vitest'
import { makeMemorySearchTool, MEMORY_SEARCH } from './memory-search'

describe('makeMemorySearchTool', () => {
  const ctx = { cwd: '.', shell: {} as never }

  it('passes the query and returns formatted hits', async () => {
    let got = ''
    const tool = makeMemorySearchTool(async (q) => {
      got = q
      return '[登录修复 · assistant] …把 add 改回了 +…'
    })
    expect(tool.def.name).toBe(MEMORY_SEARCH)
    const res = await tool.run({ query: 'login bug' }, ctx)
    expect(got).toBe('login bug')
    expect(res.content).toContain('登录修复')
  })

  it('errors on empty query and on a 0-hit miss returns a friendly note', async () => {
    const tool = makeMemorySearchTool(async () => '')
    expect((await tool.run({ query: ' ' }, ctx)).isError).toBe(true)
    const miss = await tool.run({ query: 'xyz' }, ctx)
    expect(miss.isError).toBeUndefined()
    expect(miss.content).toContain('没有找到')
  })
})
