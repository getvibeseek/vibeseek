import { describe, it, expect } from 'vitest'
import { McpClient, mcpTools, mcpToolName, type McpTransport } from './client'

/**
 * Scripted in-memory transport: auto-replies to JSON-RPC requests so the client
 * can be tested without spawning a real server.
 */
class FakeTransport implements McpTransport {
  private handler: ((msg: Record<string, unknown>) => void) | null = null
  sent: object[] = []
  toolResult = 'TOOL OUTPUT'
  toolIsError = false

  async start(): Promise<void> {}
  onMessage(cb: (msg: Record<string, unknown>) => void): void {
    this.handler = cb
  }
  send(message: Record<string, unknown>): void {
    this.sent.push(message)
    const { id, method } = message
    if (id === undefined) return // a notification, no reply
    const reply = (result: unknown): void =>
      queueMicrotask(() => this.handler?.({ jsonrpc: '2.0', id, result }))
    if (method === 'initialize') reply({ protocolVersion: '2024-11-05', capabilities: {} })
    else if (method === 'tools/list')
      reply({
        tools: [
          { name: 'read', description: 'read a file', inputSchema: { type: 'object' } },
          { name: 'write', description: 'write a file' },
        ],
      })
    else if (method === 'tools/call')
      reply({ content: [{ type: 'text', text: this.toolResult }], isError: this.toolIsError })
  }
  close(): void {}
}

describe('McpClient', () => {
  it('handshakes, lists tools, and namespaces them', async () => {
    const t = new FakeTransport()
    const client = new McpClient('fs', t)
    await client.connect()
    // initialize + notifications/initialized were sent
    expect((t.sent[0] as { method: string }).method).toBe('initialize')
    expect((t.sent[1] as { method: string }).method).toBe('notifications/initialized')

    const defs = await client.listTools()
    expect(defs.map((d) => d.name)).toEqual(['read', 'write'])

    const tools = mcpTools(client, defs)
    expect(tools[0].def.name).toBe(mcpToolName('fs', 'read'))
    expect(tools[0].def.name).toBe('mcp__fs__read')
  })

  it('calls a tool and returns its text content', async () => {
    const t = new FakeTransport()
    t.toolResult = 'file contents here'
    const client = new McpClient('fs', t)
    await client.connect()
    const tools = mcpTools(client, await client.listTools())
    const res = await tools[0].run({ path: 'a.txt' }, { cwd: '.', shell: {} as never })
    expect(res.content).toBe('file contents here')
    expect(res.isError).toBeUndefined()
  })

  it('surfaces tool errors as isError results', async () => {
    const t = new FakeTransport()
    t.toolIsError = true
    t.toolResult = 'boom'
    const client = new McpClient('fs', t)
    await client.connect()
    const tools = mcpTools(client, await client.listTools())
    const res = await tools[0].run({}, { cwd: '.', shell: {} as never })
    expect(res.isError).toBe(true)
    expect(res.content).toContain('boom')
  })
})
