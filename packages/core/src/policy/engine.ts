import { classifyCommand, type CommandClass } from './classify'

export type PermissionMode = 'plan' | 'standard' | 'yolo'

/** A decision before any user interaction. 'confirm' means ask the user. */
export type Decision = 'allow' | 'confirm' | 'deny'

export type RuleScope = 'session' | 'project'

export interface AllowRule {
  tool: string
  scope: RuleScope
}

export interface PolicyInput {
  toolName: string
  input: Record<string, unknown>
  isReadOnly: boolean
}

/**
 * Decides whether a tool call may run, needs confirmation, or is denied —
 * combining the permission mode, command classification, and the
 * persisted allowlist. Pure and synchronous; the UI handles the actual confirm
 * prompt and persistence of new rules.
 */
export class PolicyEngine {
  private readonly allow = new Set<string>()

  constructor(
    public mode: PermissionMode,
    rules: AllowRule[] = []
  ) {
    for (const r of rules) this.allow.add(this.key(r.tool))
  }

  private key(tool: string): string {
    return tool
  }

  /** Record that a tool is allowed (session/project allowlist). */
  addRule(tool: string): void {
    this.allow.add(this.key(tool))
  }

  isAllowlisted(tool: string): boolean {
    return this.allow.has(this.key(tool))
  }

  classOf(p: PolicyInput): CommandClass {
    if (p.toolName === 'shell') return classifyCommand(String(p.input.command ?? ''))
    return p.isReadOnly ? 'readonly' : 'write'
  }

  decide(p: PolicyInput): Decision {
    // Plan: read-only world. Nothing that writes or runs side effects.
    if (this.mode === 'plan') return p.isReadOnly ? 'allow' : 'deny'

    const cls = this.classOf(p)

    // Dangerous always confirms — even in YOLO, and the allowlist can't waive it.
    if (cls === 'dangerous') return 'confirm'

    if (this.mode === 'yolo') return 'allow'

    // standard
    if (cls === 'readonly') return 'allow'
    if (this.isAllowlisted(p.toolName)) return 'allow'
    return 'confirm'
  }
}
