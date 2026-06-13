import type { Tool } from '../tools/types'
import { ok, err } from '../tools/types'

/**
 * Progressive MCP tool discovery (idea credit: Kun / DeepSeek-GUI).
 * A project wired to several MCP servers can easily carry 50+ tool defs —
 * all of it dead weight in the cached prefix and noise in tool choice. Past
 * the threshold we inject TWO small tools instead:
 *
 *   mcp_find_tool(query)        → search names/descriptions, returns matches
 *                                 WITH their parameter schemas
 *   mcp_call_tool(name, args)   → dispatches to the hidden real tool
 *
 * The decision is made when a session's tool set is built, so it is frozen
 * per conversation (caching rule 2) — no mid-session swaps.
 */

export const MCP_GATEWAY_THRESHOLD = 16

export function mcpGateway(tools: Tool[], threshold = MCP_GATEWAY_THRESHOLD): Tool[] {
  if (tools.length <= threshold) return tools

  const byName = new Map(tools.map((t) => [t.def.name, t]))

  const find: Tool = {
    def: {
      name: 'mcp_find_tool',
      description:
        `Search the ${tools.length} available MCP tools by keyword. ` +
        `Returns matching tool names, descriptions and parameter schemas. ` +
        `Use mcp_call_tool to invoke one. Always search before calling.`,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords to match against names/descriptions.' },
        },
        required: ['query'],
      },
    },
    run: async (input) => {
      const query = String(input.query ?? '').toLowerCase()
      if (!query) return err('mcp_find_tool needs a non-empty query')
      const words = query.split(/\s+/).filter(Boolean)
      const scored = tools
        .map((t) => {
          const hay = `${t.def.name} ${t.def.description}`.toLowerCase()
          const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0)
          return { t, score }
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
      if (scored.length === 0) {
        return ok(`no tools matched "${query}". All tool names:\n${[...byName.keys()].join('\n')}`)
      }
      return ok(
        scored
          .map(
            ({ t }) =>
              `## ${t.def.name}\n${t.def.description}\nparameters: ${JSON.stringify(t.def.parameters)}`
          )
          .join('\n\n')
      )
    },
  }

  const call: Tool = {
    def: {
      name: 'mcp_call_tool',
      description: 'Invoke an MCP tool found via mcp_find_tool, passing its arguments object.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact tool name from mcp_find_tool.' },
          arguments: { type: 'object', description: "The tool's own arguments." },
        },
        required: ['name'],
      },
    },
    run: async (input, ctx) => {
      const name = String(input.name ?? '')
      const target = byName.get(name)
      if (!target) return err(`unknown MCP tool: ${name}. Search with mcp_find_tool first.`)
      const args = (input.arguments ?? {}) as Record<string, unknown>
      return target.run(args, ctx)
    },
  }

  return [find, call]
}
