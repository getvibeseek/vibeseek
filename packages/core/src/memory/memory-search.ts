import type { Tool } from '../tools/types'
import { ok, err } from '../tools/types'

/** Runs a recall query over past conversations; returns formatted hits text. */
export type MemorySearchRunner = (query: string) => Promise<string>

export const MEMORY_SEARCH = 'memory_search'

/**
 * `memory_search`: recall earlier conversations in THIS project by
 * full-text search — "how did we fix that login bug last time", "what did we
 * decide about the cache layer". Read-only; returns short snippets with their
 * conversation + role + time so the model can pull back prior context that
 * isn't in the current window.
 */
export function makeMemorySearchTool(run: MemorySearchRunner): Tool {
  return {
    def: {
      name: MEMORY_SEARCH,
      description:
        "Search this project's PAST conversations for relevant earlier context — e.g. " +
        '"how did we fix the login bug", "what did we decide about pricing". Returns short ' +
        'snippets with their conversation title, role and time. Use it when the user refers ' +
        'to something from before that is not in the current conversation.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to recall (keywords or a short phrase).' },
        },
        required: ['query'],
      },
    },
    run: async (input) => {
      const query = String(input.query ?? '').trim()
      if (!query) return err('memory_search needs a non-empty query')
      try {
        const hits = await run(query)
        return ok(hits || '(no matching past conversations / 没有找到相关的历史对话)')
      } catch (e) {
        return err(`memory_search failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  }
}
