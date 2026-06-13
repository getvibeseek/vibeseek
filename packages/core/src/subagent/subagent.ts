import type { Tool } from '../tools/types'
import { ok, err } from '../tools/types'

/** Runs one read-only exploration and returns its summary text (host-provided). */
export type SubagentRunner = (task: string) => Promise<string>

export const DISPATCH_SUBAGENT = 'dispatch_subagent'

/**
 * `dispatch_subagent`: hand a focused, READ-ONLY exploration to a fast
 * flash sub-agent and get back only its summary. The sub-agent does the wide
 * grep/read churn in its OWN context; the main thread receives a compact result,
 * so the main conversation never bloats with raw search output. The sub-agent
 * shares the main session's cached stable prefix, so its first turn isn't
 * billed as a full miss.
 */
export function makeSubagentTool(run: SubagentRunner): Tool {
  return {
    def: {
      name: DISPATCH_SUBAGENT,
      description:
        'Delegate a wide READ-ONLY investigation to a fast sub-agent and get back a concise ' +
        'summary. PREFER this over running many greps/reads yourself whenever a task means ' +
        'scanning the whole repo — e.g. "find every place X is used and group them", "list all ' +
        'TODO/FIXME by module", "summarize how the auth flow works". The sub-agent does that ' +
        'churn in its OWN context (your conversation stays clean) and can read/grep/glob but ' +
        'cannot edit or run commands. Give it ONE self-contained task and say exactly what to ' +
        'report back. For INDEPENDENT questions, dispatch several sub-agents in the SAME ' +
        'response — they run in parallel and you get all summaries at once.',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'A single self-contained read-only task, plus what to report back.',
          },
        },
        required: ['task'],
      },
    },
    run: async (input) => {
      const task = String(input.task ?? '').trim()
      if (!task) return err('dispatch_subagent needs a non-empty task')
      try {
        const summary = await run(task)
        return ok(summary || '(sub-agent returned nothing)')
      } catch (e) {
        return err(`sub-agent failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  }
}
