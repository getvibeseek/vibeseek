import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { McpClient, HttpTransport } from './client'

/**
 * HttpTransport against a local fake streamable-HTTP MCP server: JSON replies
 * for initialize/tools.list, an SSE reply for tools.call, and the
 * Mcp-Session-Id echo. No network beyond loopback.
 */

let server: Server
let url = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => (body += c.toString()))
    req.on('end', () => {
      const msg = JSON.parse(body) as { id?: string; method: string }
      if (msg.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' })
        res.end(
          JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05' } })
        )
      } else if (msg.method === 'notifications/initialized') {
        res.writeHead(202)
        res.end()
      } else if (msg.method === 'tools/list') {
        // The session header must round-trip from initialize.
        if (req.headers['mcp-session-id'] !== 'sess-1') {
          res.writeHead(400)
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: { tools: [{ name: 'echo', description: 'echoes input' }] },
          })
        )
      } else if (msg.method === 'tools/call') {
        // SSE-styled response: one event carrying the JSON-RPC reply.
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const reply = {
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: 'pong' }] },
        }
        res.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`)
      } else {
        res.writeHead(404)
        res.end()
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (addr && typeof addr === 'object') url = `http://127.0.0.1:${addr.port}/mcp`
})

afterAll(() => {
  server.close()
})

describe('HttpTransport', () => {
  it('handshakes, lists tools (session header echoed), calls via SSE reply', async () => {
    const client = new McpClient('hosted', new HttpTransport({ url }), 5_000)
    await client.connect()
    const tools = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(['echo'])
    const out = await client.callTool('echo', { say: 'ping' })
    expect(out).toBe('pong')
    client.close()
  })

  it('rejects fast on connection failure instead of waiting out the timeout', async () => {
    const client = new McpClient(
      'down',
      new HttpTransport({ url: 'http://127.0.0.1:1/nothing' }),
      30_000
    )
    const t0 = Date.now()
    await expect(client.connect()).rejects.toThrow()
    expect(Date.now() - t0).toBeLessThan(10_000)
  })
})
