import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Tool } from '../tools/types'
import { ok, err } from '../tools/types'

/** A configured MCP server (CC-compatible `mcpServers` entry). */
export interface McpServerConfig {
  /** stdio: spawn this command. http: ignored. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** http transport endpoint (mutually exclusive with command). */
  url?: string
}

/** A tool as advertised by an MCP server. */
export interface McpToolDef {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/**
 * Transport carries newline-delimited JSON-RPC messages to/from a server.
 * Injected so the client is testable without spawning a real process.
 */
export interface McpTransport {
  start(): Promise<void>
  send(message: object): void
  /** Register the line handler (one parsed JSON-RPC message per call). */
  onMessage(cb: (msg: Record<string, unknown>) => void): void
  close(): void
}

/** stdio transport: newline-delimited JSON-RPC over a child process (MCP spec). */
export class StdioTransport implements McpTransport {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buf = ''
  private handler: ((msg: Record<string, unknown>) => void) | null = null

  constructor(private readonly config: McpServerConfig) {}

  async start(): Promise<void> {
    if (!this.config.command) throw new Error('stdio transport needs a command')
    // Windows: `npx`/`pnpm` etc. are .cmd shims that a bare spawn can't exec
    // (EINVAL / "not a valid Win32 application") — and virtually every public
    // MCP server config says `"command": "npx"`. Route through the shell there.
    const proc = spawn(this.config.command, this.config.args ?? [], {
      env: { ...process.env, ...(this.config.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    }) as ChildProcessWithoutNullStreams
    this.proc = proc
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (chunk: string) => this.feed(chunk))
  }

  private feed(chunk: string): void {
    this.buf += chunk
    let nl: number
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      try {
        this.handler?.(JSON.parse(line) as Record<string, unknown>)
      } catch {
        // Non-JSON noise on stdout (some servers log there) — ignore.
      }
    }
  }

  send(message: object): void {
    this.proc?.stdin.write(JSON.stringify(message) + '\n')
  }

  onMessage(cb: (msg: Record<string, unknown>) => void): void {
    this.handler = cb
  }

  close(): void {
    this.proc?.kill()
    this.proc = null
  }
}

/**
 * Streamable-HTTP transport (MCP 2025-03 spec, v1 subset): every JSON-RPC
 * message POSTs to the endpoint; the response is either a single JSON body or
 * an SSE stream of messages. The `Mcp-Session-Id` header is captured from the
 * initialize response and echoed afterwards. The optional server-initiated GET
 * stream (push notifications) is not opened — request/response covers tools.
 */
export class HttpTransport implements McpTransport {
  private handler: ((msg: Record<string, unknown>) => void) | null = null
  private sessionId: string | null = null
  private closed = false

  constructor(private readonly config: McpServerConfig) {}

  async start(): Promise<void> {
    if (!this.config.url) throw new Error('http transport needs a url')
  }

  onMessage(cb: (msg: Record<string, unknown>) => void): void {
    this.handler = cb
  }

  send(message: object): void {
    void this.post(message)
  }

  /** Surface transport failures as JSON-RPC errors so the pending request
   *  rejects immediately instead of waiting out the client timeout. */
  private fail(message: object, detail: string): void {
    const id = (message as { id?: unknown }).id
    if (id === undefined || id === null) return // notifications have no reply
    this.handler?.({ jsonrpc: '2.0', id, error: { code: -32000, message: detail } })
  }

  private async post(message: object): Promise<void> {
    if (this.closed || !this.config.url) return
    try {
      const res = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}),
        },
        body: JSON.stringify(message),
      })
      const sid = res.headers.get('mcp-session-id')
      if (sid) this.sessionId = sid
      if (!res.ok) {
        this.fail(message, `HTTP ${res.status}`)
        return
      }
      const ctype = res.headers.get('content-type') ?? ''
      if (ctype.includes('text/event-stream')) {
        await this.readSse(res)
      } else if (ctype.includes('application/json')) {
        const j = (await res.json()) as Record<string, unknown> | Record<string, unknown>[]
        for (const m of Array.isArray(j) ? j : [j]) this.handler?.(m)
      }
      // 202/empty body = accepted notification — nothing to feed.
    } catch (e) {
      this.fail(message, e instanceof Error ? e.message : String(e))
    }
  }

  private async readSse(res: Response): Promise<void> {
    if (!res.body) return
    const dec = new TextDecoder()
    let buf = ''
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true }).replace(/\r\n/g, '\n')
      let sep: number
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const event = buf.slice(0, sep)
        buf = buf.slice(sep + 2)
        const data = event
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n')
        if (!data) continue
        try {
          this.handler?.(JSON.parse(data) as Record<string, unknown>)
        } catch {
          // Non-JSON SSE noise — ignore.
        }
      }
    }
  }

  close(): void {
    this.closed = true
  }
}

const PROTOCOL_VERSION = '2024-11-05'

/**
 * Minimal MCP client: handshake, tools/list, tools/call over a
 * JSON-RPC transport. One client per server. Pending requests resolve by id.
 */
export class McpClient {
  private nextId = 1
  private readonly pending = new Map<string, (r: { result?: unknown; error?: unknown }) => void>()
  private started = false

  constructor(
    readonly name: string,
    private readonly transport: McpTransport,
    private readonly timeoutMs = 15_000
  ) {}

  private request<T>(method: string, params?: object): Promise<T> {
    const id = String(this.nextId++)
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP ${this.name} ${method} timed out`))
      }, this.timeoutMs)
      this.pending.set(id, ({ result, error }) => {
        clearTimeout(timer)
        if (error) reject(new Error(JSON.stringify(error)))
        else resolve(result as T)
      })
      this.transport.send({ jsonrpc: '2.0', id, method, params: params ?? {} })
    })
  }

  /** Connect and run the initialize handshake. */
  async connect(): Promise<void> {
    if (this.started) return
    this.transport.onMessage((msg) => {
      const id = msg.id
      if (id !== undefined && id !== null) {
        const resolve = this.pending.get(String(id))
        if (resolve) {
          this.pending.delete(String(id))
          resolve({ result: msg.result, error: msg.error })
        }
      }
    })
    await this.transport.start()
    await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'vibeseek', version: '0.2' },
    })
    this.transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    this.started = true
  }

  async listTools(): Promise<McpToolDef[]> {
    const res = await this.request<{ tools?: McpToolDef[] }>('tools/list')
    return res.tools ?? []
  }

  /** Call a tool; returns the concatenated text content. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.request<{
      content?: Array<{ type: string; text?: string }>
      isError?: boolean
    }>('tools/call', { name, arguments: args })
    const text = (res.content ?? [])
      .map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`))
      .join('\n')
    if (res.isError) throw new Error(text || 'tool returned isError')
    return text
  }

  close(): void {
    this.transport.close()
    this.pending.clear()
    this.started = false
  }
}

/** MCP tool names are namespaced so they never collide with built-ins (CC style). */
export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`
}

/** Wrap a server's advertised tools as our Tool interface (calls route back). */
export function mcpTools(client: McpClient, defs: McpToolDef[]): Tool[] {
  return defs.map((d) => ({
    def: {
      name: mcpToolName(client.name, d.name),
      description: d.description ?? `MCP tool ${d.name} from ${client.name}`,
      parameters: d.inputSchema ?? { type: 'object', properties: {} },
    },
    run: async (input) => {
      try {
        return ok(await client.callTool(d.name, input))
      } catch (e) {
        return err(`MCP ${client.name}/${d.name} failed: ${e instanceof Error ? e.message : e}`)
      }
    },
  }))
}
