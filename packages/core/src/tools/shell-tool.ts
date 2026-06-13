import { type Tool, type ToolResult, ok, err } from './types'

const HEAD_LINES = 100
const TAIL_LINES = 50

/**
 * Truncate long output to head + tail (keeping error-looking lines) so a noisy
 * command can't blow up the context window. Full output goes to the agent log.
 */
function truncate(output: string): { shown: string; truncated: boolean } {
  const lines = output.split('\n')
  if (lines.length <= HEAD_LINES + TAIL_LINES) return { shown: output, truncated: false }
  const head = lines.slice(0, HEAD_LINES)
  const tail = lines.slice(-TAIL_LINES)
  const omitted = lines.length - HEAD_LINES - TAIL_LINES
  return { shown: [...head, `… [${omitted} lines omitted] …`, ...tail].join('\n'), truncated: true }
}

export const shellTool: Tool = {
  def: {
    name: 'shell',
    description:
      'Run a shell command in the project root and return combined stdout/stderr. ' +
      'Output is UTF-8 and truncated if very long.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout_ms: { type: 'number', description: 'kill after this many ms' },
      },
      required: ['command'],
    },
  },
  async run(input, ctx): Promise<ToolResult> {
    const command = String(input.command ?? '')
    if (!command) return err('shell requires command')
    const timeoutMs = input.timeout_ms ? Number(input.timeout_ms) : 120_000
    try {
      const res = await ctx.shell.run(command, { cwd: ctx.cwd, timeoutMs })
      const combined = [res.stdout, res.stderr].filter(Boolean).join('\n').trimEnd()
      const { shown, truncated } = truncate(combined)
      const header = `exit code: ${res.code}`
      const body = shown ? `${header}\n${shown}` : header
      const meta = { exitCode: res.code, truncated, fullOutput: combined }
      return res.code === 0 ? ok(body, meta) : err(body, meta)
    } catch (e) {
      return err(`shell error: ${e instanceof Error ? e.message : e}`)
    }
  },
}
