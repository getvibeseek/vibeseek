import { describe, it, expect } from 'vitest'
import { mcpGateway } from './gateway'
import { ok, type Tool, type ToolContext } from '../tools/types'
import { createShell } from '../platform/shell'

const ctx: ToolContext = { cwd: '.', shell: createShell() }

const fake = (name: string, description: string): Tool => ({
  def: { name, description, parameters: { type: 'object', properties: {} } },
  run: async (input) => ok(`${name}:${JSON.stringify(input)}`),
})

describe('mcpGateway', () => {
  it('passes small tool sets through untouched', () => {
    const tools = [fake('mcp__a__one', 'first'), fake('mcp__a__two', 'second')]
    expect(mcpGateway(tools, 16)).toBe(tools)
  })

  it('collapses large sets into find + call', async () => {
    const tools = Array.from({ length: 20 }, (_, i) =>
      fake(`mcp__srv__tool${i}`, i === 7 ? 'reads database rows' : `does thing ${i}`)
    )
    const gw = mcpGateway(tools, 16)
    expect(gw.map((t) => t.def.name)).toEqual(['mcp_find_tool', 'mcp_call_tool'])

    const found = await gw[0].run({ query: 'database rows' }, ctx)
    expect(found.isError).toBeFalsy()
    expect(found.content).toContain('mcp__srv__tool7')
    expect(found.content).toContain('parameters:')

    const called = await gw[1].run({ name: 'mcp__srv__tool7', arguments: { id: 1 } }, ctx)
    expect(called.content).toBe('mcp__srv__tool7:{"id":1}')

    const missing = await gw[1].run({ name: 'mcp__srv__nope' }, ctx)
    expect(missing.isError).toBe(true)
  })
})
