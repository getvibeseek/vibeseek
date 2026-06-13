import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { McpClient, StdioTransport, mcpTools } from './client'
import { createShell } from '../platform/shell'

// A REAL published MCP server (filesystem) runs end-to-end —
// spawn via npx, handshake, tools/list, tools/call. Needs network on first run
// (npx download), so it is gated like the API smokes:
//   MCP_SMOKE=1 pnpm -F @vibeseek/core test -t "real MCP"
const gate = process.env.MCP_SMOKE

describe('real MCP server smoke', () => {
  it.skipIf(!gate)(
    'filesystem server: handshake, list, read a file',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'vibeseek-mcp-'))
      const client = new McpClient(
        'fs',
        new StdioTransport({
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', dir],
        }),
        60_000 // npx may download the package on first run
      )
      try {
        writeFileSync(join(dir, 'hello.txt'), 'mcp smoke says hi\n')
        await client.connect()
        const defs = await client.listTools()
        expect(defs.length).toBeGreaterThan(0)
        const names = defs.map((d) => d.name)
        console.log('[mcp] tools:', names.join(', '))

        // Wrap like agent-service does and call through the Tool interface.
        const tools = mcpTools(client, defs)
        const readName = names.find((n) => /read.*file/i.test(n))
        expect(readName).toBeTruthy()
        const wrapped = tools.find((t) => t.def.name === `mcp__fs__${readName}`)
        const res = await wrapped!.run(
          { path: join(dir, 'hello.txt') },
          { cwd: dir, shell: createShell() }
        )
        expect(res.isError).toBeFalsy()
        expect(res.content).toContain('mcp smoke says hi')
        console.log('[mcp] read result ok')
      } finally {
        client.close()
        rmSync(dir, { recursive: true, force: true })
      }
    },
    120_000
  )
})
