import type { Message, ToolDef } from '../provider/types'
import { fingerprint, serializeTools, firstDiff } from './canonical'

export interface SessionContextInit {
  /** Static system prompt (CACHING RULE 1: no dynamic content). */
  systemPrompt: string
  /** Frozen tool set for the session (CACHING RULE 2). */
  tools: ToolDef[]
  /**
   * Semi-stable first user message: date, project description, dir tree, etc.
   * Written ONCE at session start and never mutated (半稳定层).
   */
  contextMessage: string
}

export interface DriftReport {
  drifted: boolean
  layer?: 'system' | 'tools'
  /** First differing character index (for the dev panel / log). */
  at?: number
}

/**
 * Builds the request message array under the prefix-stability rules:
 *   [stable: system] + [semi-stable: context user msg] + [active: append-only].
 * The stable/semi-stable layers are fixed at construction; the active layer only
 * ever grows (CACHING RULE 3 — no reorder, no rewrite, no in-place trim).
 */
export class SessionContext {
  readonly systemPrompt: string
  readonly contextMessage: string
  private readonly tools: ToolDef[]
  private readonly lockedSystemFp: string
  private readonly lockedToolsSerialized: string
  private readonly lockedToolsFp: string
  private readonly active: Message[] = []

  constructor(init: SessionContextInit) {
    this.systemPrompt = init.systemPrompt
    this.contextMessage = init.contextMessage
    this.tools = init.tools
    this.lockedSystemFp = fingerprint(init.systemPrompt)
    this.lockedToolsSerialized = serializeTools(init.tools)
    this.lockedToolsFp = fingerprint(this.lockedToolsSerialized)
  }

  get toolFingerprint(): string {
    return this.lockedToolsFp
  }

  get systemFingerprint(): string {
    return this.lockedSystemFp
  }

  /** Append to the active layer. Never reorders or rewrites history. */
  append(message: Message): void {
    this.active.push(message)
  }

  /**
   * RULE-4 sanctioned batch compaction: collapse the whole active
   * layer into ONE summary user message which becomes the new prefix head.
   * Never called per-turn — the host triggers it once at the threshold, and
   * the summary must carry the user's verbatim requests (Reasonix lesson:
   * never let a summary wash out what the user actually asked for).
   */
  compact(summaryText: string): void {
    this.active.length = 0
    this.active.push({ role: 'user', content: [{ type: 'text', text: summaryText }] })
  }

  /** Rough token estimate of the full request (chars/3 — zh/en mix heuristic). */
  estimateTokens(): number {
    let chars = this.systemPrompt.length + this.contextMessage.length
    for (const m of this.active) {
      for (const block of m.content) {
        chars += JSON.stringify(block).length
      }
    }
    return Math.ceil(chars / 3)
  }

  /** The active (mutable, append-only) history — a copy. */
  get history(): Message[] {
    return [...this.active]
  }

  /** Assemble the full message array for a request. */
  build(): Message[] {
    return [
      { role: 'system', content: [{ type: 'text', text: this.systemPrompt }] },
      { role: 'user', content: [{ type: 'text', text: this.contextMessage }] },
      ...this.active,
    ]
  }

  /**
   * Verify the stable layer hasn't drifted from what was locked at session start.
   * Call before each request: a mismatch means a cache-breaking change slipped
   * in (e.g. an edited system prompt or a mid-session tool addition).
   */
  verify(systemPrompt: string, tools: ToolDef[]): DriftReport {
    if (fingerprint(systemPrompt) !== this.lockedSystemFp) {
      return { drifted: true, layer: 'system', at: firstDiff(this.systemPrompt, systemPrompt) }
    }
    const serialized = serializeTools(tools)
    if (fingerprint(serialized) !== this.lockedToolsFp) {
      return {
        drifted: true,
        layer: 'tools',
        at: firstDiff(this.lockedToolsSerialized, serialized),
      }
    }
    return { drifted: false }
  }
}
