import type { ToolDef } from '../provider/types'
import { type Tool, type ToolContext, type ToolResult, err } from './types'
import { readFileTool, writeFileTool, globTool } from './fs-tools'
import { grepTool } from './grep'
import { editFileTool } from './edit'
import { shellTool } from './shell-tool'

/** Read-only tools are safe to auto-run and to execute in parallel.
 *  use_skill only loads instructions (no side effects), so it's read-only too. */
export const READ_ONLY_TOOLS = new Set([
  'read_file',
  'grep',
  'glob',
  'use_skill',
  // dispatch_subagent only spawns a read-only explorer — safe to auto-run.
  'dispatch_subagent',
  // memory_search only reads past conversations.
  'memory_search',
  // update_plan only reports task-list state to the UI — no side effects.
  'update_plan',
  // mcp_find_tool only searches tool descriptions (gateway).
  'mcp_find_tool',
])

export const ALL_TOOLS: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  grepTool,
  globTool,
  shellTool,
]

export class ToolRegistry {
  private readonly byName = new Map<string, Tool>()

  constructor(tools: Tool[] = ALL_TOOLS) {
    for (const t of tools) this.byName.set(t.def.name, t)
  }

  /** Tool definitions for the provider request (order-independent — context layer sorts). */
  defs(): ToolDef[] {
    return [...this.byName.values()].map((t) => t.def)
  }

  isReadOnly(name: string): boolean {
    return READ_ONLY_TOOLS.has(name)
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = this.byName.get(name)
    if (!tool) return err(`unknown tool: ${name}`)
    try {
      return await tool.run(input, ctx)
    } catch (e) {
      return err(`tool ${name} threw: ${e instanceof Error ? e.message : e}`)
    }
  }
}
