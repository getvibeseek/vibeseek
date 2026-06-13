import type { Tool } from '../tools/types'
import { ok, err } from '../tools/types'

/** One step of the agent's visible task plan (任务清单面板). */
export interface PlanItem {
  text: string
  status: 'pending' | 'in_progress' | 'done'
}

export const UPDATE_PLAN = 'update_plan'

const STATUSES = new Set(['pending', 'in_progress', 'done'])

/**
 * A read-only tool the model calls to keep a visible task list in sync while
 * it works (the UI renders it in the side panel). Each call REPLACES the whole
 * list — stateless for the model, trivial to render. No file/system effects,
 * so it auto-runs without permission prompts.
 */
export function makeUpdatePlanTool(onUpdate: (items: PlanItem[]) => void): Tool {
  return {
    def: {
      name: UPDATE_PLAN,
      description:
        'Maintain a visible task plan for multi-step work. Call it when you start a task ' +
        'that takes more than ~2 steps (all items pending, first in_progress), and again ' +
        'after finishing each step (mark it done, move in_progress forward). Pass the FULL ' +
        'list every time — it replaces the previous one. Keep items short (≤10 words).',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'The complete plan, in order.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'The step, short and concrete.' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
              },
              required: ['text', 'status'],
            },
          },
        },
        required: ['items'],
      },
    },
    run: async (input) => {
      const raw = input.items
      if (!Array.isArray(raw)) return err('update_plan needs an items array')
      const items: PlanItem[] = []
      for (const entry of raw) {
        const text = String((entry as { text?: unknown })?.text ?? '').trim()
        const status = String((entry as { status?: unknown })?.status ?? '')
        if (!text || !STATUSES.has(status)) {
          return err('each item needs text and a status of pending|in_progress|done')
        }
        items.push({ text, status: status as PlanItem['status'] })
      }
      onUpdate(items)
      return ok(
        `plan updated: ${items.filter((i) => i.status === 'done').length}/${items.length} done`
      )
    },
  }
}
