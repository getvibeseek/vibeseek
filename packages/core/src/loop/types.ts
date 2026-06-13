import type { ChatRequest, StreamEvent, Usage } from '../provider/types'
import type { ToolResult } from '../tools/types'
import type { DriftReport } from '../context/session-context'

/** What the loop needs from a provider — ProviderClient implements it; tests fake it. */
export interface ChatStreamer {
  stream(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent>
}

/** Permission decision for a tool invocation (the host supplies the real policy). */
export type PermitDecision = 'allow' | 'deny'
export type PermitFn = (name: string, input: Record<string, unknown>) => Promise<PermitDecision>

/** Events emitted during a run for the UI to stream. */
export type LoopEvent =
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; id: string; name: string; result: ToolResult }
  | { type: 'usage'; usage: Usage; turnHitRate: number; sessionHitRate: number }
  | { type: 'drift'; report: DriftReport }
  | { type: 'error'; message: string }
  /** Informational host notice (routing decisions, budget downgrades…). */
  | { type: 'notice'; message: string }
  | { type: 'done'; finalText: string; aborted: boolean }
