import type { ContentBlock, ThinkingEffort, ToolCall, Usage } from '../provider/types'
import { EMPTY_USAGE } from '../provider/types'
import type { SessionContext } from '../context/session-context'
import { SYSTEM_PROMPT } from '../context/system-prompt'
import { HitRateAccumulator, turnHitRate } from '../meter/hit-rate'
import type { ToolRegistry } from '../tools/registry'
import type { ToolContext, ToolResult } from '../tools/types'
import { err as toolErr } from '../tools/types'
import type { ChatStreamer, LoopEvent, PermitFn } from './types'

export interface AgentLoopDeps {
  streamer: ChatStreamer
  registry: ToolRegistry
  context: SessionContext
  toolContext: ToolContext
  model: string
  thinking?: ThinkingEffort
  /**
   * Optional per-turn override of model/thinking, read before EVERY request —
   * lets the host downgrade mid-task (budget cap) without rebuilding the loop.
   */
  paramsOverride?: () => Partial<{ model: string; thinking: ThinkingEffort }>
  /** Defaults to allow-all; the host injects the permission policy. */
  permit?: PermitFn
  maxIterations?: number
  readonlyBatchSize?: number
}

const DEFAULT_MAX_ITERATIONS = 25
const DEFAULT_READONLY_BATCH = 3
const DUPLICATE_LIMIT = 2 // 3rd identical call is suppressed

/**
 * Drives one task to completion: model turn -> tool calls -> results -> repeat
 * until a turn has no tool calls (final answer), the iteration cap is hit, or
 * the signal aborts. ALL state lives on the instance — no module-level mutable
 * state — so multiple loops run concurrently without cross-talk (multi-tab).
 */
export class AgentLoop {
  private readonly acc = new HitRateAccumulator()
  private totalUsage: Usage = { ...EMPTY_USAGE }
  private readonly dupCounts = new Map<string, number>()

  constructor(private readonly deps: AgentLoopDeps) {}

  get sessionUsage(): Usage {
    return { ...this.totalUsage }
  }
  get sessionHitRate(): number {
    return this.acc.rate
  }

  async *run(userText: string, signal?: AbortSignal): AsyncGenerator<LoopEvent> {
    const { context, registry } = this.deps
    context.append({ role: 'user', content: [{ type: 'text', text: userText }] })

    const maxIter = this.deps.maxIterations ?? DEFAULT_MAX_ITERATIONS
    for (let iter = 0; iter < maxIter; iter++) {
      if (signal?.aborted) {
        yield { type: 'done', finalText: '', aborted: true }
        return
      }

      // Prefix-stability guard: the stable layer must not have drifted.
      const drift = context.verify(SYSTEM_PROMPT, registry.defs())
      if (drift.drifted) yield { type: 'drift', report: drift }

      // Stream one model turn. reasoning_content is streamed for the UI but NOT
      // accumulated into history (it never goes back to the model).
      let text = ''
      let toolCalls: ToolCall[] = []
      let usage: Usage = { ...EMPTY_USAGE }
      const override = this.deps.paramsOverride?.() ?? {}
      try {
        for await (const ev of this.deps.streamer.stream(
          {
            model: override.model ?? this.deps.model,
            messages: context.build(),
            tools: registry.defs(),
            thinking: override.thinking ?? this.deps.thinking,
          },
          signal
        )) {
          if (ev.type === 'reasoning') {
            yield { type: 'reasoning', delta: ev.delta }
          } else if (ev.type === 'text') {
            text += ev.delta
            yield { type: 'text', delta: ev.delta }
          } else {
            toolCalls = ev.result.toolCalls
            usage = ev.result.usage
          }
        }
      } catch (e) {
        yield { type: 'error', message: e instanceof Error ? e.message : String(e) }
        yield { type: 'done', finalText: text, aborted: !!signal?.aborted }
        return
      }

      this.acc.add(usage)
      this.totalUsage = addUsage(this.totalUsage, usage)
      yield {
        type: 'usage',
        usage,
        turnHitRate: turnHitRate(usage),
        sessionHitRate: this.acc.rate,
      }

      // Record the assistant turn (text + tool_use blocks), append-only.
      const assistantBlocks: ContentBlock[] = []
      if (text) assistantBlocks.push({ type: 'text', text })
      for (const tc of toolCalls) {
        assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })
      }
      context.append({ role: 'assistant', content: assistantBlocks })

      if (toolCalls.length === 0) {
        yield { type: 'done', finalText: text, aborted: false }
        return
      }

      // Surface tool_start BEFORE execution: long tools (installs, builds) and
      // permission waits would otherwise leave the UI silent for minutes —
      // users read that as a hang and abort. Events are UI-only; the history
      // pairing below stays unchanged.
      for (const tc of toolCalls) {
        yield { type: 'tool_start', id: tc.id, name: tc.name, input: tc.input }
      }

      // Execute tools and append paired results (one user message).
      const results = await this.executeToolCalls(toolCalls, signal)
      const resultBlocks: ContentBlock[] = toolCalls.map((tc, i) => ({
        type: 'tool_result',
        toolUseId: tc.id,
        content: results[i].result.content,
        isError: results[i].result.isError,
      }))
      context.append({ role: 'user', content: resultBlocks })

      for (const r of results) {
        yield { type: 'tool_end', id: r.call.id, name: r.call.name, result: r.result }
      }
    }

    yield { type: 'error', message: `reached max iterations (${maxIter})` }
    yield { type: 'done', finalText: '', aborted: false }
  }

  private async executeToolCalls(
    calls: ToolCall[],
    signal: AbortSignal | undefined
  ): Promise<Array<{ call: ToolCall; result: ToolResult }>> {
    const { registry } = this.deps
    const results = new Array<{ call: ToolCall; result: ToolResult }>(calls.length)

    // Run read-only calls in parallel batches; everything else sequentially
    // (writes need ordering + permission). Results stay in original call order.
    const indices = calls.map((_, i) => i)
    const readonly = indices.filter((i) => registry.isReadOnly(calls[i].name))
    const others = indices.filter((i) => !registry.isReadOnly(calls[i].name))

    const batch = this.deps.readonlyBatchSize ?? DEFAULT_READONLY_BATCH
    for (let i = 0; i < readonly.length; i += batch) {
      const slice = readonly.slice(i, i + batch)
      await Promise.all(
        slice.map(async (idx) => {
          results[idx] = { call: calls[idx], result: await this.runOne(calls[idx], signal) }
        })
      )
    }
    for (const idx of others) {
      results[idx] = { call: calls[idx], result: await this.runOne(calls[idx], signal) }
    }
    return results
  }

  private async runOne(call: ToolCall, signal: AbortSignal | undefined): Promise<ToolResult> {
    if (signal?.aborted) return toolErr('aborted')

    // Duplicate circuit breaker (吸收 Kun 教训): suppress the 3rd identical call.
    const sig = `${call.name}:${JSON.stringify(call.input)}`
    const seen = this.dupCounts.get(sig) ?? 0
    this.dupCounts.set(sig, seen + 1)
    if (seen >= DUPLICATE_LIMIT) {
      return toolErr(`repeated identical call to ${call.name} suppressed — vary the input or stop`)
    }

    // Permission gate (default allow). Read-only tools auto-allow.
    if (!this.deps.registry.isReadOnly(call.name) && this.deps.permit) {
      const decision = await this.deps.permit(call.name, call.input)
      if (decision === 'deny') return toolErr(`denied by user: ${call.name}`)
    }

    return this.deps.registry.execute(call.name, call.input, this.deps.toolContext as ToolContext)
  }
}

function addUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    cacheHitTokens: a.cacheHitTokens + b.cacheHitTokens,
    cacheMissTokens: a.cacheMissTokens + b.cacheMissTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  }
}
