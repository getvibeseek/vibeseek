import type { Shell } from '../platform/shell'
import type { ToolDef } from '../provider/types'

/** Unified tool result. content is what goes back to the model. */
export interface ToolResult {
  content: string
  isError?: boolean
  /** Diagnostics (e.g. edit match level, truncation) — logged, not sent raw. */
  meta?: Record<string, unknown>
}

export interface ToolContext {
  /** Project root; all relative paths resolve against it. */
  cwd: string
  shell: Shell
}

export interface Tool {
  def: ToolDef
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}

export function ok(content: string, meta?: Record<string, unknown>): ToolResult {
  return meta ? { content, meta } : { content }
}

export function err(content: string, meta?: Record<string, unknown>): ToolResult {
  return { content, isError: true, ...(meta ? { meta } : {}) }
}
