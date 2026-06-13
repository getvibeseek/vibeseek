import { BrowserWindow, dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  readdirSync,
  statSync,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  cpSync,
  type Dirent,
} from 'node:fs'
import { join, relative, resolve, sep, basename } from 'node:path'
import { homedir } from 'node:os'
import {
  AgentLoop,
  ProviderClient,
  SessionContext,
  SYSTEM_PROMPT,
  ToolRegistry,
  PolicyEngine,
  ModelRegistry,
  HitRateAccumulator,
  GitCheckpoints,
  cost,
  savings as savingsOf,
  createShell,
  EMPTY_USAGE,
  triageRoute,
  parseDirectives,
  completeOnce,
  ProjectMemory,
  ALL_TOOLS,
  loadSkills,
  makeSkillTool,
  makeSubagentTool,
  makeMemorySearchTool,
  makeUpdatePlanTool,
  type PlanItem,
  buildRepoDigest,
  McpClient,
  StdioTransport,
  HttpTransport,
  mcpTools,
  mcpGateway,
  type McpServerConfig,
  type RepoDigest,
  type LoopEvent,
  type Message,
  type ContentBlock,
  type PermitDecision,
  type ToolContext,
  type ToolResult,
  type Tool,
} from '@vibeseek/core'
import {
  IPC,
  type PermissionRequest,
  type PermitGrant,
  type PersistedMessage,
  type PersistedTool,
  type SessionMeta,
  type UsageSummary,
  type ModelUsageLine,
  type TaskReceipt,
  type ReceiptScope,
  type DashboardStats,
  type DashboardData,
  type RequestCostPoint,
  type ProjectStats,
  type DevTurn,
  type DevDrift,
  type DevInfo,
  type OverviewInfo,
  type DirEntry,
  type FilePreview,
  type SkillInfo,
  type MemoryScope,
} from '../../shared/ipc'
import type { SettingsStore } from '../store/settings-store'
import type { KeyStore } from '../security/key-store'
import type { Logger } from '../logging/logger'
import type { BalanceService } from '../balance-service'
import type { UsageStore } from '../db/usage-store'
import type { SessionStore } from '../db/session-store'
import { ChangeTracker } from './change-tracker'
import { notifyBackground } from '../notifications'
import { tr } from '../i18n'

const RECENT_PROJECTS_CAP = 12

// Compaction thresholds (fractions of the context window). Checkpoints
// are written in the background well before compaction needs one, so when the
// 60% line is crossed a fresh snapshot is almost always already on disk.
const COMPACT_AT = 0.6
/**
 * Keep a fresh checkpoint once the context holds this many tokens (absolute,
 * NOT a window fraction — with a 1M window a percentage threshold would never
 * fire, and what a checkpoint protects against is replay cost/latency).
 */
const CHECKPOINT_MIN_TOKENS = 10_000
/** Restored sessions longer than this (est. tokens) rebuild from checkpoint. */
const RESTORE_FROM_CHECKPOINT_AT = 12_000

/** Background sub-agent instruction: write the session hand-off snapshot. */
const CHECKPOINT_PROMPT = (): string => tr('prompt.checkpoint')

/** Background sub-agent instruction: distill durable project knowledge. */
const MEMORY_PROMPT = (existing: string | null): string =>
  tr('prompt.memory', { existing: existing ?? tr('prompt.memoryEmpty') })

/** Prepended to the user turn when plan mode is on (协作方式). */
const PLAN_PREAMBLE = (): string => tr('prompt.plan')

interface SessionMeter {
  acc: HitRateAccumulator
  cost: number
  savings: number
  tokens: number
}

/** Registry that snapshots files before write/edit so changes can be reviewed. */
class TrackingRegistry extends ToolRegistry {
  constructor(
    private readonly tracker: ChangeTracker,
    private readonly onChange: () => void,
    tools: Tool[]
  ) {
    super(tools)
  }
  override async execute(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const writes = name === 'write_file' || name === 'edit_file'
    if (writes && typeof input.path === 'string') this.tracker.snapshot(input.path)
    const result = await super.execute(name, input, ctx)
    if (writes && !result.isError) this.onChange()
    return result
  }
}

export class AgentService {
  // Per-session concurrency (user-reversed the single-task decision):
  // each session runs independently — sets/maps keyed by sessionId, never a
  // global lock. running = sessions with a task in flight; controllers = their
  // aborts; live = the in-flight assistant partial so switching back re-attaches.
  private readonly running = new Set<string>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly live = new Map<
    string,
    { text: string; tools: PersistedTool[]; startedAt: number; model: string }
  >()
  // Resolves when a session's in-flight run fully finishes (for rewind-during-run).
  private readonly runDone = new Map<string, Promise<void>>()
  private readonly pending = new Map<string, (grant: PermitGrant) => void>()
  // Per-session change ledgers (会话总账): kept warm and persisted, so
  // the Changes panel survives session switches and restarts.
  private readonly trackers = new Map<string, ChangeTracker>()
  // Per-session pre-task git shadow commit, for 回滚全部 (rollbackTask).
  private readonly lastCheckpoints = new Map<string, string>()
  private readonly models = new ModelRegistry()
  private readonly shell = createShell()

  // Per-session conversation context + meter, kept warm for the app lifetime.
  private currentSessionId: string | null = null
  private readonly contexts = new Map<string, SessionContext>()
  private readonly meters = new Map<string, SessionMeter>()
  // Developer-panel history: per-session turn metrics + drift incidents.
  private readonly devTurns = new Map<string, DevTurn[]>()
  private readonly devDrifts = new Map<string, DevDrift[]>()
  // Sessions with a background memory/checkpoint writer in flight.
  private readonly bgBusy = new Set<string>()
  // Day-cost alert fires at most once per day.
  private dayCostAlertedOn = ''
  // Sessions restored by FULL replay of a long history (no checkpoint): their
  // first task pays miss price on everything and waits a long prefill — warn
  // the user once at that task's start (会话恢复提示).
  private readonly coldRestored = new Set<string>()
  // 概览面板 state: last task duration + last compaction per session.
  private readonly lastTaskMs = new Map<string, number>()
  private readonly compactedAt = new Map<string, string>()
  // MCP: per-project connected clients + their wrapped tools, connect-once.
  private readonly mcpClients = new Map<string, McpClient[]>()
  private readonly mcpToolsByProject = new Map<string, Tool[]>()
  private readonly mcpReady = new Map<string, Promise<void>>()
  // Superseded by a reconnect (e.g. after 添加服务器) but possibly still serving
  // older sessions' frozen tool sets — closed at app quit, never earlier.
  private readonly retiredMcpClients: McpClient[] = []
  // 全库模式: whether the digest fit (active) + last digest, per project.
  private readonly repoModeActive = new Map<string, boolean>()
  private readonly repoModeDigest = new Map<string, RepoDigest>()
  // Sessions already told about their 全库模式 cost (once per session).
  private readonly repoNoticed = new Set<string>()
  // Whether each session was actually built with the whole repo baked in — set
  // at context-build time and locked for that session's life (the badge reads it).
  private readonly sessionRepo = new Map<string, boolean>()
  // 回滚/恢复 (workspace state changes outside the model's view): a one-shot,
  // model-only note prepended to the next turn so the agent knows files moved —
  // NOT a deletable message, cleared after one use. + a redo commit per session.
  private readonly workspaceNote = new Map<string, string>()
  private readonly redoCommit = new Map<string, string>()
  // 任务清单: the agent's visible plan, replaced wholesale per
  // update_plan call. In-memory per session — ephemeral by design.
  private readonly plans = new Map<string, PlanItem[]>()

  constructor(
    private readonly settings: SettingsStore,
    private readonly keys: KeyStore,
    private readonly logger: Logger,
    private readonly balance: BalanceService,
    private readonly usage: UsageStore | null = null,
    private readonly sessions: SessionStore | null = null
  ) {}

  getTracker(): ChangeTracker | null {
    const id = this.currentSessionId
    if (!id) return null
    // Lazily rehydrate from the on-disk ledger so the Changes panel shows a
    // session's accumulated edits even after a restart or a session switch —
    // not only while a run that touched files is still warm in memory.
    const dir = this.sessions?.get(id)?.project_dir ?? this.settings.get('projectDir')
    if (!dir) return this.trackers.get(id) ?? null
    return this.trackerFor(id, dir)
  }

  /** Get-or-create the persisted change ledger for a session. */
  private trackerFor(sessionId: string, projectDir: string): ChangeTracker {
    let tracker = this.trackers.get(sessionId)
    if (!tracker) {
      const ledger = new ProjectMemory(projectDir).changesFile(sessionId)
      tracker = new ChangeTracker(projectDir, ledger)
      this.trackers.set(sessionId, tracker)
    }
    return tracker
  }

  // ---------- project management ----------

  recentProjects(): string[] {
    return this.settings.get('recentProjects')
  }

  /**
   * Add a project to the recents list ONLY if it's new — switching between
   * existing projects must NOT reorder the list. Re-promoting on every switch
   * made the sidebar jump around and read like a bug (user feedback). New
   * projects go to the front; known ones keep their position.
   */
  private ensureRecent(dir: string): void {
    const recents = this.settings.get('recentProjects')
    if (recents.includes(dir)) return
    this.settings.set('recentProjects', [dir, ...recents].slice(0, RECENT_PROJECTS_CAP))
  }

  /** Add (if new) a directory to recents and make it current. Order is stable. */
  setProject(dir: string): void {
    this.ensureRecent(dir)
    this.settings.set('projectDir', dir)
    // Switching project drops the current conversation selection.
    this.currentSessionId = null
    this.send(IPC.projectChange)
    this.send(IPC.sessionChange)
    this.sendMeter() // status bar now reflects the newly-selected project's totals
  }

  // ---------- session management ----------

  currentSession(): string | null {
    return this.currentSessionId
  }

  listSessions(dir?: string): SessionMeta[] {
    const target = dir ?? this.settings.get('projectDir')
    if (!target || !this.sessions) return []
    return this.sessions.list(target)
  }

  /** Create a new empty conversation (optionally in a specific project) and select it. */
  async newSession(targetDir?: string): Promise<string | null> {
    if (targetDir && targetDir !== this.settings.get('projectDir')) this.setProject(targetDir)
    const dir = this.settings.get('projectDir')
    if (!dir || !this.sessions) return null
    // Connect MCP before building context so the tool set is frozen complete.
    await this.ensureMcp(dir)
    const id = randomUUID()
    this.sessions.create(id, dir, new Date().toISOString())
    this.contexts.set(id, this.buildContext(dir, [], id))
    this.meters.set(id, this.seedMeter(id))
    this.currentSessionId = id
    this.send(IPC.sessionChange)
    this.sendMeter()
    return id
  }

  /** Read a conversation's messages without selecting it (复制对话 etc.). */
  peekSession(id: string): PersistedMessage[] {
    return this.sessions?.messages(id) ?? []
  }

  /** Search conversations across all projects (sidebar 搜索). */
  searchSessions(query: string): ReturnType<SessionStore['searchAllSessions']> {
    return this.sessions?.searchAllSessions(query) ?? []
  }

  /**
   * Branch a new conversation from the prefix up to (and including) messageId
   * (Fork). Copies messages into a fresh session sharing the same cached
   * prefix — no API spend, no file changes — and selects it.
   */
  forkSession(sessionId: string, messageId: number): string | null {
    if (!this.sessions) return null
    const dir = this.sessions.get(sessionId)?.project_dir ?? this.settings.get('projectDir')
    if (!dir) return null
    const prefix = this.sessions
      .messages(sessionId)
      .filter((m) => m.id !== undefined && m.id <= messageId)
    if (prefix.length === 0) return null
    const newId = randomUUID()
    const now = new Date().toISOString()
    this.sessions.create(newId, dir, now)
    for (const m of prefix) this.sessions.append(newId, m, m.ts ?? now)
    const srcTitle = this.sessions.get(sessionId)?.title ?? ''
    this.sessions.setTitle(newId, srcTitle ? `${srcTitle} ${tr('fork.suffix')}` : '', now)
    this.contexts.set(newId, this.buildContext(dir, prefix, newId))
    this.meters.set(newId, this.seedMeter(newId))
    this.currentSessionId = newId
    this.send(IPC.sessionChange)
    return newId
  }

  /**
   * Rewind: drop messageId and everything after it, and restore the
   * working tree to the git checkpoint captured before that turn ran. The
   * conversation is truncated either way; files only roll back when that turn
   * carries a checkpoint and the project is a repo. Returns the kept messages.
   */
  async rewindSession(sessionId: string, messageId: number): Promise<PersistedMessage[]> {
    if (!this.sessions) return []
    // Rewinding a still-running task must first STOP it — otherwise its stream
    // keeps going and its finally would re-append a turn after we truncate.
    if (this.running.has(sessionId)) {
      this.controllers.get(sessionId)?.abort()
      await this.runDone.get(sessionId)?.catch(() => {})
    }
    const dir = this.sessions.get(sessionId)?.project_dir ?? this.settings.get('projectDir')
    const target = this.sessions.messages(sessionId).find((m) => m.id === messageId)
    if (dir && target?.checkpoint) {
      try {
        await new GitCheckpoints(dir, this.shell).rollback(target.checkpoint)
      } catch (e) {
        this.logger.appWarn('rewind rollback failed', {
          message: e instanceof Error ? e.message : String(e),
        })
      }
    }
    this.sessions.truncateFrom(sessionId, messageId, new Date().toISOString())
    const remaining = this.sessions.messages(sessionId)
    if (dir) this.contexts.set(sessionId, this.buildContext(dir, remaining, sessionId))
    // Ledger kept: it's a live original-vs-disk diff, so rewound edits drop out
    // by themselves while earlier (still-present) session edits stay listed.
    this.send(IPC.sessionChange)
    this.send(IPC.changesUpdate)
    return remaining
  }

  /** Select an existing conversation; returns its messages for the renderer. */
  async selectSession(id: string): Promise<PersistedMessage[]> {
    if (!this.sessions) return []
    const msgs = this.sessions.messages(id)
    this.currentSessionId = id
    const dir = this.sessions.get(id)?.project_dir ?? this.settings.get('projectDir')
    // Selecting a session that belongs to another project also switches the
    // active project — the agent must run in the session's own directory.
    // A vanished directory must NOT become the active project (ENOENT spam).
    if (dir && dir !== this.settings.get('projectDir') && existsSync(dir)) {
      this.ensureRecent(dir)
      this.settings.set('projectDir', dir)
      this.send(IPC.projectChange)
    }
    if (dir) await this.ensureMcp(dir)
    if (dir && !this.contexts.has(id)) {
      // Restoring an old session: the server cache has almost certainly
      // expired, so a full replay would pay miss price on everything anyway.
      // With a checkpoint on disk, a small rebuilt prefix is strictly cheaper;
      // short sessions just replay.
      const checkpoint = new ProjectMemory(dir).readCheckpoint(id)
      const replayEstimate = Math.ceil(JSON.stringify(msgs).length / 3)
      if (checkpoint && replayEstimate > RESTORE_FROM_CHECKPOINT_AT) {
        const ctx = this.buildContext(dir, [], id)
        const userTexts = msgs.filter((m) => m.role === 'user').map((m) => m.text)
        ctx.compact(this.compactSummary(checkpoint, userTexts))
        this.contexts.set(id, ctx)
        this.logger.api({ kind: 'restore-from-checkpoint', sessionId: id, replayEstimate })
      } else {
        this.contexts.set(id, this.buildContext(dir, msgs, id))
        if (replayEstimate > RESTORE_FROM_CHECKPOINT_AT) this.coldRestored.add(id)
      }
    }
    // Restore the session's accumulated cost/hit-rate from usage_log so it
    // doesn't reset to zero across restarts (user feedback).
    if (!this.meters.has(id)) this.meters.set(id, this.seedMeter(id))
    // The per-session ledger (if any) loads lazily on first access; just tell
    // the panel to re-fetch for the newly-current session.
    this.send(IPC.changesUpdate)
    this.sendMeter()
    return msgs
  }

  /**
   * Recompute an aggregate's cost/savings from its tokens at CURRENT registry
   * prices, so a price correction retroactively fixes every display rather than
   * trusting the (possibly stale) stored cost column.
   */
  private priceOf(agg: {
    model: string
    hitTokens: number
    missTokens: number
    outputTokens: number
    cost: number
  }): { cost: number; saved: number } {
    if (!this.models.has(agg.model)) return { cost: agg.cost, saved: 0 }
    const p = this.models.get(agg.model).pricing
    return {
      cost:
        (agg.hitTokens * p.cacheHit + agg.missTokens * p.cacheMiss + agg.outputTokens * p.output) /
        1_000_000,
      saved: (agg.hitTokens * (p.cacheMiss - p.cacheHit)) / 1_000_000,
    }
  }

  /** Build a session meter, restoring totals from persisted usage_log rows. */
  private seedMeter(sessionId: string): SessionMeter {
    const acc = new HitRateAccumulator()
    let runningCost = 0
    let runningSaved = 0
    let tokens = 0
    for (const r of this.usage?.sessionByModel(sessionId) ?? []) {
      const m = this.priceOf(r)
      runningCost += m.cost
      runningSaved += m.saved
      tokens += r.hitTokens + r.missTokens + r.outputTokens
      acc.add({ ...EMPTY_USAGE, cacheHitTokens: r.hitTokens, cacheMissTokens: r.missTokens })
    }
    return { acc, cost: runningCost, savings: runningSaved, tokens }
  }

  /** Clear the selection: the composer becomes a draft; next send creates anew. */
  deselect(): void {
    this.currentSessionId = null
    this.send(IPC.sessionChange)
    this.send(IPC.changesUpdate)
    this.sendMeter()
  }

  /** Rename a conversation (user-chosen title; auto-titling stops touching it). */
  renameSession(id: string, title: string): void {
    if (!this.sessions) return
    this.sessions.setTitle(id, title.trim().slice(0, 80), new Date().toISOString())
    this.send(IPC.sessionChange)
  }

  /** Delete a conversation and its messages; clears selection if it was current. */
  removeSession(id: string): void {
    if (!this.sessions) return
    this.controllers.get(id)?.abort()
    this.controllers.delete(id)
    this.running.delete(id)
    this.live.delete(id)
    this.lastCheckpoints.delete(id)
    this.redoCommit.delete(id)
    this.workspaceNote.delete(id)
    this.sessions.delete(id)
    this.contexts.delete(id)
    this.meters.delete(id)
    this.trackers.get(id)?.reset()
    this.trackers.delete(id)
    if (this.currentSessionId === id) {
      this.currentSessionId = null
      this.sendMeter() // zero the status-bar "this session" block (no live session)
    }
    this.send(IPC.sessionChange)
  }

  /** Remove a project from the recents list (data stays in the DB). */
  removeRecentProject(dir: string): void {
    this.settings.set(
      'recentProjects',
      this.settings.get('recentProjects').filter((d) => d !== dir)
    )
    if (this.settings.get('projectDir') === dir) {
      this.settings.set('projectDir', null)
      this.currentSessionId = null
      this.sendMeter() // zero the status-bar "this session" block
    }
    this.send(IPC.projectChange)
    this.send(IPC.sessionChange)
  }

  /**
   * Aggregate settlement receipt for a conversation or a whole project,
   * computed from usage_log (multi-model rows priced per model).
   */
  receiptFor(target: ReceiptScope): TaskReceipt | null {
    if (!this.usage) return null
    const rows =
      target.scope === 'session'
        ? this.usage.sessionByModel(target.id)
        : target.scope === 'project'
          ? this.usage.projectByModel(target.id)
          : // month: id is 'YYYY-MM' — everything since that month's first day.
            this.usage.byModel(`${target.id}-01T00:00:00.000Z`)
    if (rows.length === 0) return null

    let hit = 0
    let miss = 0
    let output = 0
    let thinking = 0
    let requests = 0
    let totalCost = 0
    let fullPrice = 0
    // Per-model lines, priced at current rates (not stored cost).
    const byModel = rows
      .map((r) => {
        hit += r.hitTokens
        miss += r.missTokens
        output += r.outputTokens
        thinking += r.thinkingTokens
        requests += r.requests
        const priced = this.priceOf(r)
        totalCost += priced.cost
        const pricing = this.models.has(r.model) ? this.models.get(r.model).pricing : null
        fullPrice += pricing
          ? ((r.hitTokens + r.missTokens) * pricing.cacheMiss + r.outputTokens * pricing.output) /
            1_000_000
          : priced.cost
        return {
          model: r.model,
          requests: r.requests,
          hitTokens: r.hitTokens,
          missTokens: r.missTokens,
          outputTokens: r.outputTokens,
          thinkingTokens: r.thinkingTokens,
          cost: priced.cost,
        }
      })
      .sort((a, b) => b.cost - a.cost)
    const savedAmt = fullPrice - totalCost

    const name =
      target.scope === 'session'
        ? this.sessions?.get(target.id)?.title || tr('receipt.sessionFallback')
        : target.scope === 'month'
          ? tr('receipt.monthBill', { y: target.id.slice(0, 4), m: Number(target.id.slice(5, 7)) })
          : (target.id.split(/[\\/]/).filter(Boolean).pop() ?? target.id)
    const modelLabel = rows.map((r) => r.model.replace('deepseek-', '')).join(' + ')

    return {
      ts: new Date().toISOString(),
      taskName: name,
      model: modelLabel,
      hitTokens: hit,
      missTokens: miss,
      outputTokens: output,
      thinkingTokens: thinking,
      cost: totalCost,
      fullPrice,
      saved: savedAmt,
      savedPct: fullPrice > 0 ? savedAmt / fullPrice : 0,
      durationMs: 0,
      requests,
      byModel,
    }
  }

  /** Aggregated usage for the bottom-left usage popover. */
  usageSummary(): UsageSummary {
    if (!this.usage) return { todayCost: 0, totalCost: 0, totalSaved: 0, byModel: [] }
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const today = this.usage.byModel(startOfDay.toISOString())
    const all = this.usage.byModel('')
    // Price everything at CURRENT rates, not the stored cost column.
    const line = (r: (typeof all)[number]): ModelUsageLine => {
      const priced = this.priceOf(r)
      return { ...r, cost: priced.cost, saved: priced.saved }
    }
    const byModel = all.map(line)
    return {
      todayCost: today.reduce((s, r) => s + this.priceOf(r).cost, 0),
      totalCost: byModel.reduce((s, r) => s + r.cost, 0),
      totalSaved: byModel.reduce((s, r) => s + r.saved, 0),
      byModel,
    }
  }

  /** Wipe all usage history (settings → reset stats). Conversations are kept. */
  resetUsage(): void {
    this.usage?.reset()
    this.sendMeter() // status bar back to zero immediately
  }

  /** Headline stats for the achievement page, priced at current rates. */
  dashboardStats(): DashboardStats {
    const empty: DashboardStats = {
      monthSaved: 0,
      monthCost: 0,
      totalSaved: 0,
      totalCost: 0,
      hitRate: 0,
      sessions: 0,
      requests: 0,
      totalTokens: 0,
      activeDays: 0,
      streak: 0,
      heatmap: [],
      peakHour: null,
      topModel: null,
    }
    if (!this.usage) return empty
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    const monthRows = this.usage.byModel(monthStart)
    const allRows = this.usage.byModel('')
    const totals = this.usage.totals()
    const sumSaved = (rows: typeof allRows): number =>
      rows.reduce((s, r) => s + this.priceOf(r).saved, 0)
    const sumCost = (rows: typeof allRows): number =>
      rows.reduce((s, r) => s + this.priceOf(r).cost, 0)
    const denom = totals.hitTokens + totals.missTokens
    const allDays = this.usage.daily('')
    // Heatmap window: trailing 17 weeks (119 days, ending today).
    const windowStart = new Date(now)
    windowStart.setUTCDate(now.getUTCDate() - 118)
    const winIso = windowStart.toISOString().slice(0, 10)
    // Peak hour: rows are bucketed by UTC hour; shift each bucket into local
    // time before picking the max (DST shifts old buckets by ≤1h — fine for a
    // "when are you most active" card).
    const offsetHours = Math.round(-now.getTimezoneOffset() / 60)
    const byLocalHour = new Map<number, number>()
    for (const h of this.usage.hourly()) {
      const local = (Number(h.hour) + offsetHours + 24) % 24
      byLocalHour.set(local, (byLocalHour.get(local) ?? 0) + h.requests)
    }
    let peakHour: number | null = null
    let peakCount = 0
    for (const [hour, count] of byLocalHour) {
      if (count > peakCount) {
        peakHour = hour
        peakCount = count
      }
    }
    const topModel = allRows.length
      ? allRows.reduce((a, b) => (b.requests > a.requests ? b : a)).model
      : null

    return {
      monthSaved: sumSaved(monthRows),
      monthCost: sumCost(monthRows),
      totalSaved: sumSaved(allRows),
      totalCost: sumCost(allRows),
      hitRate: denom ? totals.hitTokens / denom : 0,
      sessions: this.sessions?.countAll() ?? 0,
      requests: totals.requests,
      totalTokens: totals.hitTokens + totals.missTokens + totals.outputTokens,
      activeDays: allDays.length,
      streak: streakOf(allDays.map((d) => d.day)),
      heatmap: allDays.filter((d) => d.day >= winIso),
      peakHour,
      topModel,
    }
  }

  /** Range-scoped dashboard payload (完整版). null = all time. */
  dashboard(rangeDays: number | null): DashboardData {
    const empty: DashboardData = {
      rangeDays,
      cost: 0,
      saved: 0,
      hitRate: 0,
      tokens: 0,
      requests: 0,
      sessions: 0,
      messages: 0,
      activeDays: 0,
      streak: 0,
      longestStreak: 0,
      heatmap: [],
      models: [],
      daily: [],
      topSessions: [],
    }
    if (!this.usage) return empty

    const since = rangeDays
      ? new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString()
      : ''
    const models = this.usage.byModel(since).map((r) => {
      const priced = this.priceOf(r)
      return { ...r, cost: priced.cost, saved: priced.saved }
    })
    const hit = models.reduce((s, m) => s + m.hitTokens, 0)
    const miss = models.reduce((s, m) => s + m.missTokens, 0)
    const output = models.reduce((s, m) => s + m.outputTokens, 0)

    // Session ranking: per-session per-model rows priced, then summed.
    const titles = this.sessions?.titles() ?? new Map<string, string>()
    const perSession = new Map<string, { cost: number; requests: number }>()
    for (const r of this.usage.sessionsSince(since)) {
      const cur = perSession.get(r.session) ?? { cost: 0, requests: 0 }
      cur.cost += this.priceOf(r).cost
      cur.requests += r.requests
      perSession.set(r.session, cur)
    }
    const topSessions = [...perSession.entries()]
      .map(([id, v]) => ({ id, title: titles.get(id) || tr('untitled'), ...v }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8)

    // All-time day list for streaks + trailing-17-week heatmap.
    const allDays = this.usage.daily('')
    const now = new Date()
    const windowStart = new Date(now)
    windowStart.setUTCDate(now.getUTCDate() - 118)
    const winIso = windowStart.toISOString().slice(0, 10)

    return {
      rangeDays,
      cost: models.reduce((s, m) => s + m.cost, 0),
      saved: models.reduce((s, m) => s + m.saved, 0),
      hitRate: hit + miss ? hit / (hit + miss) : 0,
      tokens: hit + miss + output,
      requests: models.reduce((s, m) => s + m.requests, 0),
      sessions: perSession.size,
      messages: this.sessions?.countMessagesSince(since) ?? 0,
      activeDays: allDays.length,
      streak: streakOf(allDays.map((d) => d.day)),
      longestStreak: longestStreakOf(allDays.map((d) => d.day)),
      heatmap: allDays.filter((d) => d.day >= winIso),
      models,
      daily: this.usage.dailyByModel(since).map((r) => ({
        day: r.day,
        model: r.model,
        tokens: r.hitTokens + r.missTokens + r.outputTokens,
      })),
      topSessions,
    }
  }

  /** Per-request cost timeline of one conversation. */
  timeline(sessionId: string): RequestCostPoint[] {
    return this.usage?.requestsOf(sessionId) ?? []
  }

  // ---------- memory & compaction ----------

  /** Best prompt-size estimate: last real request, else serialized-length guess. */
  private promptTokensOf(sessionId: string, context: SessionContext): number {
    const turns = this.devTurns.get(sessionId)
    const last = turns?.[turns.length - 1]
    return last ? last.hit + last.miss : context.estimateTokens()
  }

  /** The compacted prefix head: snapshot + the user's verbatim requests. */
  private compactSummary(checkpoint: string | null, userTexts: string[]): string {
    const numbered = userTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')
    return [
      tr('compact.header'),
      '',
      tr('compact.snapshot'),
      checkpoint ?? tr('compact.noSnapshot'),
      '',
      tr('compact.requests'),
      numbered || tr('compact.none'),
    ].join('\n')
  }

  /** Shared-prefix background completion: history + one instruction. */
  private async subAgent(
    client: ProviderClient,
    context: SessionContext,
    tools: ToolRegistry,
    instruction: string,
    sessionId: string
  ): Promise<string | null> {
    try {
      const messages: Message[] = [
        ...context.build(),
        { role: 'user', content: [{ type: 'text', text: instruction }] },
      ]
      const model = this.models.defaultModel
      const { text, usage } = await completeOnce(client, model, messages, tools.defs())
      // Sub-agent spend is attributed to its session (receipts stay honest).
      if (usage.promptTokens > 0) {
        this.usage?.record(model, usage, this.models.get(model).pricing, sessionId)
      }
      return text || null
    } catch (e) {
      this.logger.appWarn('background sub-agent failed', {
        message: e instanceof Error ? e.message : String(e),
      })
      return null
    }
  }

  /** Compact the context at the 60% threshold (rule 4: one batch, never per-turn). */
  private async compactContext(
    sessionId: string,
    projectDir: string,
    context: SessionContext,
    tools: ToolRegistry,
    client: ProviderClient
  ): Promise<void> {
    const mem = new ProjectMemory(projectDir)
    // Prefer the background-maintained snapshot; fall back to writing one now.
    const checkpoint =
      mem.readCheckpoint(sessionId) ??
      (await this.subAgent(client, context, tools, CHECKPOINT_PROMPT(), sessionId))
    if (checkpoint) mem.writeCheckpoint(sessionId, checkpoint)
    const userTexts = (this.sessions?.messages(sessionId) ?? [])
      .filter((m) => m.role === 'user')
      .map((m) => m.text)
    context.compact(this.compactSummary(checkpoint, userTexts))
    this.compactedAt.set(sessionId, new Date().toISOString())
    this.send(IPC.agentEvent, {
      sessionId,
      event: {
        type: 'notice',
        message: tr('notice.compacted'),
      } satisfies LoopEvent,
    })
    this.logger.api({ kind: 'compact', sessionId })
  }

  /** After a task: refresh the session checkpoint + distill MEMORY.md, in background. */
  private scheduleMemoryWriters(
    sessionId: string,
    projectDir: string,
    context: SessionContext,
    tools: ToolRegistry,
    client: ProviderClient,
    requests: number
  ): void {
    // Worth a snapshot when the task did real work OR the context is already
    // big enough that a cold restore would hurt (cost AND first-token wait).
    const filling = this.promptTokensOf(sessionId, context) >= CHECKPOINT_MIN_TOKENS
    if ((requests < 2 && !filling) || this.bgBusy.has(sessionId)) return
    this.bgBusy.add(sessionId)
    void (async () => {
      try {
        const mem = new ProjectMemory(projectDir)
        const snapshot = await this.subAgent(client, context, tools, CHECKPOINT_PROMPT(), sessionId)
        if (snapshot) mem.writeCheckpoint(sessionId, snapshot)
        const distilled = await this.subAgent(
          client,
          context,
          tools,
          MEMORY_PROMPT(mem.readMemory()),
          sessionId
        )
        if (distilled && !distilled.startsWith('NO_UPDATE')) {
          mem.writeMemory(distilled.slice(0, 8_000))
        }
      } finally {
        this.bgBusy.delete(sessionId)
      }
    })()
  }

  // ---------- memory files (设置→记忆, transparency rule) ----------

  /** Memory store for a scope: 'project' = current project, 'global' = ~/.vibeseek
   *  (cross-project personalization; user-managed, never auto-distilled). */
  private memoryFor(scope: MemoryScope): ProjectMemory | null {
    if (scope === 'global') return new ProjectMemory(homedir())
    const dir = this.settings.get('projectDir')
    return dir ? new ProjectMemory(dir) : null
  }

  memoryList(scope: MemoryScope = 'project'): Array<{ name: string; size: number; mtime: string }> {
    try {
      return this.memoryFor(scope)?.list() ?? []
    } catch {
      return []
    }
  }

  memoryRead(name: string, scope: MemoryScope = 'project'): string {
    return this.memoryFor(scope)?.read(name) ?? ''
  }

  memoryWrite(name: string, content: string, scope: MemoryScope = 'project'): void {
    this.memoryFor(scope)?.write(name, content)
  }

  memoryRemove(name: string, scope: MemoryScope = 'project'): void {
    this.memoryFor(scope)?.remove(name)
  }

  /** 概览面板 snapshot of the current session. */
  overviewInfo(): OverviewInfo {
    const sessionId = this.currentSessionId
    const empty: OverviewInfo = {
      sessionId,
      contextTokens: 0,
      contextWindow: this.models.get(this.models.defaultModel).contextWindow,
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      requests: 0,
      cost: 0,
      saved: 0,
      hitRate: 0,
      lastTaskMs: null,
      running: false,
      compactedAt: null,
      checkpointAt: null,
    }
    if (!sessionId) return empty
    const ctx = this.contexts.get(sessionId)
    const meter = this.meters.get(sessionId)
    const rows = (this.usage?.sessionByModel(sessionId) ?? []).map((r) => ({
      ...r,
      ...this.priceOf(r),
    }))
    const hit = rows.reduce((s, r) => s + r.hitTokens, 0)
    const miss = rows.reduce((s, r) => s + r.missTokens, 0)
    const dir = this.settings.get('projectDir')
    let checkpointAt: string | null = null
    if (dir) {
      const mtime = new ProjectMemory(dir).checkpointMtime(sessionId)
      checkpointAt = mtime ? new Date(mtime).toISOString() : null
    }
    return {
      ...empty,
      contextTokens: ctx ? this.promptTokensOf(sessionId, ctx) : 0,
      promptTokens: hit + miss,
      completionTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
      reasoningTokens: rows.reduce((s, r) => s + r.thinkingTokens, 0),
      requests: rows.reduce((s, r) => s + r.requests, 0),
      cost: rows.reduce((s, r) => s + r.cost, 0),
      saved: rows.reduce((s, r) => s + r.saved, 0),
      hitRate: meter?.acc.rate ?? (hit + miss ? hit / (hit + miss) : 0),
      lastTaskMs: this.lastTaskMs.get(sessionId) ?? null,
      running: this.running.has(sessionId),
      compactedAt: this.compactedAt.get(sessionId) ?? null,
      checkpointAt,
    }
  }

  /** Developer-panel snapshot of the current session (Ctrl+Shift+D). */
  devInfo(): DevInfo {
    const sessionId = this.currentSessionId
    const ctx = sessionId ? this.contexts.get(sessionId) : undefined
    return {
      sessionId,
      systemFp: ctx?.systemFingerprint ?? null,
      toolsFp: ctx?.toolFingerprint ?? null,
      turns: sessionId ? (this.devTurns.get(sessionId) ?? []) : [],
      drifts: sessionId ? (this.devDrifts.get(sessionId) ?? []) : [],
    }
  }

  /** Project-scoped stats for the project home view. */
  projectStats(dir: string): ProjectStats {
    const models = (this.usage?.projectByModel(dir) ?? []).map((r) => {
      const priced = this.priceOf(r)
      return { ...r, cost: priced.cost, saved: priced.saved }
    })
    const hit = models.reduce((s, m) => s + m.hitTokens, 0)
    const miss = models.reduce((s, m) => s + m.missTokens, 0)
    const output = models.reduce((s, m) => s + m.outputTokens, 0)
    // Same trailing window as the global heatmap (17 weeks).
    const windowStart = new Date()
    windowStart.setUTCDate(windowStart.getUTCDate() - 118)
    const winIso = windowStart.toISOString().slice(0, 10)
    return {
      dir,
      sessions: this.sessions?.list(dir).length ?? 0,
      messages: this.sessions?.countMessagesOfProject(dir) ?? 0,
      requests: models.reduce((s, m) => s + m.requests, 0),
      tokens: hit + miss + output,
      cost: models.reduce((s, m) => s + m.cost, 0),
      saved: models.reduce((s, m) => s + m.saved, 0),
      hitRate: hit + miss ? hit / (hit + miss) : 0,
      models,
      heatmap: (this.usage?.projectDaily(dir) ?? []).filter((d) => d.day >= winIso),
    }
  }

  // ---------- git safety net ----------

  async isRepo(): Promise<boolean> {
    const dir = this.settings.get('projectDir')
    if (!dir) return false
    return new GitCheckpoints(dir, this.shell).isRepo()
  }

  async initRepo(): Promise<void> {
    const dir = this.settings.get('projectDir')
    if (dir) await new GitCheckpoints(dir, this.shell).init()
  }

  async gitBranch(): Promise<string | null> {
    const dir = this.settings.get('projectDir')
    if (!dir) return null
    return new GitCheckpoints(dir, this.shell).branch()
  }

  /** 还原所有文件改动 to the pre-task checkpoint (conversation kept). Reversible:
   *  the current state is snapshotted first so 恢复改动 can roll forward. The
   *  agent is told via a one-shot model-only note so its view stays in sync. */
  async rollbackTask(): Promise<boolean> {
    const sid = this.currentSessionId
    const dir = this.settings.get('projectDir')
    const ckpt = sid ? this.lastCheckpoints.get(sid) : undefined
    if (!sid || !dir || !ckpt) return false
    const gc = new GitCheckpoints(dir, this.shell)
    // Snapshot the current (post-edit) tree first so the rollback is undoable.
    const pre = await gc.create('pre-rollback')
    if (pre?.commit) this.redoCommit.set(sid, pre.commit)
    else this.logger.appWarn('pre-rollback snapshot failed — 恢复改动 unavailable', { dir })
    await gc.rollback(ckpt)
    // NO ledger reset: the changes list is a live original-vs-disk diff, so it
    // empties by itself after the rollback and comes back after 恢复改动.
    this.workspaceNote.set(sid, tr('note.rolledBack'))
    this.send(IPC.changesUpdate)
    this.send(IPC.agentEvent, {
      sessionId: sid,
      event: {
        type: 'notice',
        message: tr('notice.rolledBack'),
      } satisfies LoopEvent,
    })
    return true
  }

  /** Whether a 恢复改动 (redo) is available for the current conversation. */
  canRedoRollback(): boolean {
    return this.currentSessionId ? this.redoCommit.has(this.currentSessionId) : false
  }

  /** Undo the last 回滚: roll the working tree forward to the pre-rollback snapshot. */
  async redoRollback(): Promise<boolean> {
    const sid = this.currentSessionId
    const dir = this.settings.get('projectDir')
    const redo = sid ? this.redoCommit.get(sid) : undefined
    if (!sid || !dir || !redo) return false
    await new GitCheckpoints(dir, this.shell).rollback(redo)
    this.redoCommit.delete(sid)
    // Ledger untouched — the restored edits diff against their originals again,
    // so the changes list reappears on its own (user-reported bug).
    this.workspaceNote.set(sid, tr('note.redone'))
    this.send(IPC.changesUpdate)
    this.send(IPC.agentEvent, {
      sessionId: sid,
      event: { type: 'notice', message: tr('notice.redone') } satisfies LoopEvent,
    })
    return true
  }

  /** Abort a session's in-flight task (defaults to the viewed/current one). */
  abort(sessionId?: string): void {
    const id = sessionId ?? this.currentSessionId
    if (id) this.controllers.get(id)?.abort()
  }

  /** Whether a session has a task in flight + its streamed-so-far partial. */
  runningState(sessionId: string): {
    running: boolean
    text: string
    tools: PersistedTool[]
    startedAt: number | null
    model: string
  } {
    const live = this.live.get(sessionId)
    return {
      running: this.running.has(sessionId),
      text: live?.text ?? '',
      tools: live?.tools ?? [],
      startedAt: live?.startedAt ?? null,
      model: live?.model ?? '',
    }
  }

  resolvePermission(id: string, grant: PermitGrant): void {
    const resolve = this.pending.get(id)
    if (resolve) {
      this.pending.delete(id)
      resolve(grant)
    }
  }

  // ---------- run a task ----------

  async run(text: string): Promise<void> {
    const projectDir = this.settings.get('projectDir')
    if (!projectDir) return this.emitError(tr('err.noProject'))
    // Deleted/unplugged while open: fail with words, not ENOENT spam.
    if (!existsSync(projectDir)) return this.emitError(tr('err.projectGone'))
    const apiKey = this.keys.get()
    if (!apiKey) return this.emitError(tr('err.noKey'))

    // Ensure MCP servers are connected and a conversation exists.
    await this.ensureMcp(projectDir)
    if (!this.currentSessionId) await this.newSession()
    const sessionId = this.currentSessionId
    if (!sessionId) return this.emitError(tr('err.noSession'))
    // Per-session busy guard (concurrency): a task already running in THIS
    // session blocks a re-send to it; other sessions run in parallel.
    if (this.running.has(sessionId)) {
      return this.emitError(tr('err.busy'))
    }
    const context = this.contexts.get(sessionId) ?? this.buildContext(projectDir, [], sessionId)
    this.contexts.set(sessionId, context)
    const meter = this.meters.get(sessionId) ?? {
      acc: new HitRateAccumulator(),
      cost: 0,
      savings: 0,
      tokens: 0,
    }
    this.meters.set(sessionId, meter)

    // Persist the user turn FIRST and mark running IMMEDIATELY: every later step
    // here (git snapshot's `add -A`, triage) can take seconds, and a user who
    // switches away and back during that window must still see their message and
    // the running state (user report ×3 — this ordering is the actual fix).
    const now = new Date().toISOString()
    const userMsgId = this.sessions?.append(sessionId, { role: 'user', text }, now)
    if (this.sessions?.get(sessionId)?.title === '') {
      this.sessions.setTitle(sessionId, text.slice(0, 40), now)
      this.send(IPC.sessionChange)
    }
    this.running.add(sessionId)
    this.live.set(sessionId, { text: '', tools: [], startedAt: Date.now(), model: '' })
    let resolveRunDone = (): void => {}
    this.runDone.set(sessionId, new Promise<void>((r) => (resolveRunDone = r)))

    // Git safety net: snapshot the tree before the agent touches files;
    // the commit is attached to the just-persisted user turn (rewind anchor).
    // Guarded — running was already marked above and must not leak on a throw.
    try {
      const checkpoints = new GitCheckpoints(projectDir, this.shell)
      if (await checkpoints.isRepo()) {
        const ckpt = await checkpoints.create(text.slice(0, 60))
        if (ckpt?.commit) {
          this.lastCheckpoints.set(sessionId, ckpt.commit)
          if (userMsgId !== undefined) this.sessions?.setMessageCheckpoint(userMsgId, ckpt.commit)
        }
      }
    } catch (e) {
      this.logger.appWarn('task checkpoint failed', {
        message: e instanceof Error ? e.message : String(e),
      })
    }

    // Per-session ledger, accumulated across tasks (会话总账) — NOT reset per run.
    const tracker = this.trackerFor(sessionId, projectDir)
    const registry = new TrackingRegistry(
      tracker,
      () => this.send(IPC.changesUpdate),
      this.toolsFor(projectDir, sessionId)
    )
    const projectAllow = this.settings.get('allowlist')[projectDir] ?? []
    // planMode is a collaboration toggle, not a level: it overrides to read-only.
    const effectiveMode = this.settings.get('planMode')
      ? 'plan'
      : this.settings.get('permissionMode')
    const policy = new PolicyEngine(
      effectiveMode,
      projectAllow.map((tool) => ({ tool, scope: 'project' as const }))
    )
    const client = new ProviderClient({ baseUrl: this.settings.get('baseUrl'), apiKey })

    // Routing: slash directives > per-project memory > global settings;
    // 'auto' goes through triage (tiny flash call, 4s timeout → heuristic fallback).
    const directives = parseDirectives(text)
    const projectPref = this.settings.get('projectModels')[projectDir]
    const baseModel = projectPref?.model ?? this.settings.get('model')
    const baseThinking = projectPref?.thinking ?? this.settings.get('thinking')
    let model = directives.model ?? baseModel
    let thinking: 'off' | 'high' | 'max' =
      directives.thinking ?? (baseThinking === 'auto' ? 'high' : baseThinking)
    if (model === 'auto' || (baseThinking === 'auto' && !directives.thinking)) {
      const route = await triageRoute(client, directives.text)
      if (model === 'auto') model = route.model
      if (baseThinking === 'auto' && !directives.thinking) thinking = route.thinking
      this.send(IPC.agentEvent, {
        sessionId,
        event: {
          type: 'notice',
          message: tr('notice.autoRoute', {
            model: model.replace('deepseek-', ''),
            think: tr(`think.${thinking}`),
            src: tr(route.source === 'triage' ? 'route.triage' : 'route.heuristic'),
            tier: route.tier,
          }),
        } satisfies LoopEvent,
      })
    } else if (directives.model || directives.thinking) {
      this.send(IPC.agentEvent, {
        sessionId,
        event: {
          type: 'notice',
          message: tr('notice.override', {
            model: model.replace('deepseek-', ''),
            think: tr(`think.${thinking}`),
          }),
        } satisfies LoopEvent,
      })
    }

    // Record the resolved model in the live buffer so a re-attaching renderer
    // (after switching away during selection) can still show what was picked.
    const liveModel = this.live.get(sessionId)
    if (liveModel) liveModel.model = model

    // Budget cap: nearing the per-task limit downgrades to flash+off.
    const budget = this.settings.get('taskBudget')
    let downgraded = false
    const fallbackModel = this.models.defaultModel

    const contextWindow = this.models.get(model === 'auto' ? fallbackModel : model).contextWindow

    // 全库模式: tell the user once what the whole-repo prefix costs this
    // turn (and that it's ~free afterwards), or that the repo was too big and we
    // stayed in normal mode.
    if (this.settings.get('repoMode')[projectDir] && !this.repoNoticed.has(sessionId)) {
      this.repoNoticed.add(sessionId)
      const digest = this.repoModeDigest.get(projectDir)
      const pricing = this.models.get(model === 'auto' ? fallbackModel : model).pricing
      if (this.repoModeActive.get(projectDir) && digest) {
        const firstMiss = (digest.tokenEstimate * pricing.cacheMiss) / 1_000_000
        this.send(IPC.agentEvent, {
          sessionId,
          event: {
            type: 'notice',
            message: tr('notice.repoOn', {
              files: digest.fileCount,
              kt: Math.round(digest.tokenEstimate / 1000),
              yuan: firstMiss.toFixed(3),
            }),
          } satisfies LoopEvent,
        })
      } else {
        // Two reasons repo mode didn't activate: an EMPTY project (no readable
        // source — "0K over 300K" reads as nonsense) vs an OVER-BUDGET one.
        const empty = !digest || digest.fileCount === 0
        const total = digest ? Math.round(digest.totalTokenEstimate / 1000) : '?'
        this.send(IPC.agentEvent, {
          sessionId,
          event: {
            type: 'notice',
            message: empty ? tr('notice.repoEmpty') : tr('notice.repoOver', { kt: total }),
          } satisfies LoopEvent,
        })
      }
    }

    // 会话恢复提示: a long history was fully replayed and the server-side
    // cache has expired — the first turn pays miss price AND a long prefill.
    if (this.coldRestored.has(sessionId)) {
      this.coldRestored.delete(sessionId)
      const est = this.promptTokensOf(sessionId, context)
      const missYuan =
        (est * this.models.get(model === 'auto' ? fallbackModel : model).pricing.cacheMiss) /
        1_000_000
      this.send(IPC.agentEvent, {
        sessionId,
        event: {
          type: 'notice',
          message: tr('notice.coldRestore', {
            kt: Math.round(est / 1000),
            yuan: missYuan.toFixed(3),
          }),
        } satisfies LoopEvent,
      })
    }

    // Batch compaction: past the threshold, collapse history into a
    // checkpoint-based prefix head BEFORE this task's user turn is appended.
    if (this.promptTokensOf(sessionId, context) / contextWindow >= COMPACT_AT) {
      // Guarded: running/live were opened above; a throw here (e.g. fs write)
      // must not bypass the finally that clears them, or the session would leak
      // a permanent "busy" flag.
      try {
        await this.compactContext(sessionId, projectDir, context, registry, client)
        this.devTurns.delete(sessionId)
      } catch (e) {
        this.logger.appWarn('compaction failed', {
          message: e instanceof Error ? e.message : String(e),
        })
      }
    }

    const loop = new AgentLoop({
      streamer: client,
      registry,
      context,
      toolContext: { cwd: projectDir, shell: this.shell },
      model,
      thinking,
      // Real coding tasks routinely exceed the core default (25); 60 gives room
      // before the "发『继续』" nudge, without unbounding a runaway loop.
      maxIterations: 60,
      paramsOverride: () => (downgraded ? { model: fallbackModel, thinking: 'off' } : {}),
      permit: (name, input) => this.permit(policy, registry, projectDir, name, input),
    })

    // Accumulate the assistant turn for persistence.
    let asstText = ''
    const toolMap = new Map<string, PersistedTool>()

    // Per-task tallies for the settlement receipt. fullPrice accumulates
    // per-event at that event's effective model pricing (downgrades change it).
    const taskStart = Date.now()
    const task = { hit: 0, miss: 0, output: 0, thinking: 0, cost: 0, fullPrice: 0, requests: 0 }
    // Drift detector: a >30pp turn-over-turn hit-rate drop gets surfaced.
    let lastTurnRate: number | null = null

    // Plan mode is a collaboration mode, not just a permission lock: the model
    // must KNOW to investigate read-only and produce a plan. Inject the directive
    // into the user turn (append-only, cache-safe) — persistence/title keep the
    // original text above; only the model sees the preamble.
    let promptText = this.settings.get('planMode')
      ? PLAN_PREAMBLE() + directives.text
      : directives.text
    // /skill:<name>: the user pinned a skill — tell the model to load it
    // FIRST and follow it. Active-layer instruction only, cache-safe.
    if (directives.skill) {
      promptText = tr('note.skillForced', { name: directives.skill }) + '\n\n' + promptText
      this.send(IPC.agentEvent, {
        sessionId,
        event: {
          type: 'notice',
          message: tr('notice.skillForced', { name: directives.skill }),
        } satisfies LoopEvent,
      })
    }
    // One-shot workspace-state note (after a 回滚/恢复): the agent's context is
    // stale relative to disk — prepend the heads-up for THIS turn only, then
    // clear it. Not a stored message, so it can't be deleted or go stale.
    const wsNote = this.workspaceNote.get(sessionId)
    if (wsNote) {
      promptText = `${wsNote}\n\n${promptText}`
      this.workspaceNote.delete(sessionId)
    }

    const controller = new AbortController()
    this.controllers.set(sessionId, controller)
    // running + live were opened right after the user turn was persisted (above)
    // so the model-selection window is covered.
    try {
      for await (const rawEv of loop.run(promptText, controller.signal)) {
        // A user-initiated stop surfaces as a stream AbortError — show it as a
        // plain-words notice; the iteration cap likewise reads in plain words.
        let ev: LoopEvent = rawEv
        if (rawEv.type === 'error' && controller.signal.aborted) {
          ev = { type: 'notice', message: tr('notice.stopped') }
        } else if (rawEv.type === 'error' && /max iterations/.test(rawEv.message)) {
          ev = { type: 'notice', message: tr('notice.maxIter') }
        }
        this.send(IPC.agentEvent, { sessionId, event: ev })
        const liveBuf = this.live.get(sessionId)
        if (ev.type === 'text') {
          asstText += ev.delta
          if (liveBuf) liveBuf.text += ev.delta
        } else if (ev.type === 'tool_start') {
          toolMap.set(ev.id, { id: ev.id, name: ev.name, input: ev.input })
          liveBuf?.tools.push({ id: ev.id, name: ev.name, input: ev.input })
        } else if (ev.type === 'tool_end') {
          const t = toolMap.get(ev.id)
          if (t) t.result = { content: ev.result.content, isError: ev.result.isError }
          const lt = liveBuf?.tools.find((x) => x.id === ev.id)
          if (lt) lt.result = { content: ev.result.content, isError: ev.result.isError }
        } else if (ev.type === 'usage') {
          // Pricing follows the model that actually served this turn.
          const turnModel = downgraded ? fallbackModel : model
          const pricing = this.models.get(turnModel).pricing
          meter.acc.add(ev.usage)
          meter.cost += cost(ev.usage, pricing)
          meter.savings += savingsOf(ev.usage, pricing)
          meter.tokens += ev.usage.promptTokens + ev.usage.completionTokens
          task.hit += ev.usage.cacheHitTokens
          task.miss += ev.usage.cacheMissTokens
          task.output += ev.usage.completionTokens
          task.thinking += ev.usage.reasoningTokens
          task.cost += cost(ev.usage, pricing)
          task.fullPrice +=
            ((ev.usage.cacheHitTokens + ev.usage.cacheMissTokens) * pricing.cacheMiss +
              ev.usage.completionTokens * pricing.output) /
            1_000_000
          task.requests += 1
          this.usage?.record(turnModel, ev.usage, pricing, sessionId)
          this.logger.api({ kind: 'turn', usage: ev.usage, turnHitRate: ev.turnHitRate })
          // Only the viewed session drives the status-bar meter; background
          // sessions still accumulate their own stored meter silently.
          if (sessionId === this.currentSessionId) {
            this.send(IPC.meterUpdate, {
              sessionCost: meter.cost,
              saved: meter.savings,
              sessionHitRate: meter.acc.rate,
              contextPercent: Math.min(1, ev.usage.promptTokens / contextWindow),
              sessionTokens: meter.tokens,
            })
          }
          // Drift detector: sudden hit-rate collapse vs the previous turn.
          if (lastTurnRate !== null && lastTurnRate - ev.turnHitRate > 0.3) {
            this.send(IPC.agentEvent, {
              sessionId,
              event: {
                type: 'notice',
                message: tr('notice.hitDrop', {
                  prev: Math.round(lastTurnRate * 100),
                  cur: Math.round(ev.turnHitRate * 100),
                }),
              } satisfies LoopEvent,
            })
            this.logger.api({
              kind: 'drift',
              prevRate: lastTurnRate,
              rate: ev.turnHitRate,
            })
          }
          lastTurnRate = ev.turnHitRate
          // Dev panel: per-turn metrics, capped to the last 200 turns.
          const turns = this.devTurns.get(sessionId) ?? []
          turns.push({
            ts: new Date().toISOString(),
            model: turnModel,
            hit: ev.usage.cacheHitTokens,
            miss: ev.usage.cacheMissTokens,
            output: ev.usage.completionTokens,
            rate: ev.turnHitRate,
          })
          this.devTurns.set(sessionId, turns.slice(-200))
          // Budget cap: cross 80% of the limit → downgrade the next turns.
          if (budget && !downgraded && task.cost >= budget * 0.8) {
            downgraded = true
            this.send(IPC.agentEvent, {
              sessionId,
              event: {
                type: 'notice',
                message: tr('notice.budget', { cap: budget.toFixed(2) }),
              } satisfies LoopEvent,
            })
          }
        } else if (ev.type === 'drift') {
          // Prefix drift: the stable layer changed mid-session — every
          // later turn pays miss price. Tell the user in plain words.
          this.send(IPC.agentEvent, {
            sessionId,
            event: {
              type: 'notice',
              message: tr('notice.drift', {
                layer: tr(ev.report.layer === 'tools' ? 'drift.tools' : 'drift.system'),
                at: ev.report.at ?? 0,
              }),
            } satisfies LoopEvent,
          })
          this.logger.api({ kind: 'prefix-drift', report: ev.report })
          const drifts = this.devDrifts.get(sessionId) ?? []
          drifts.push({
            ts: new Date().toISOString(),
            layer: ev.report.layer ?? 'tools',
            at: ev.report.at ?? 0,
          })
          this.devDrifts.set(sessionId, drifts.slice(-50))
        } else if (ev.type === 'error') {
          this.logger.appError('agent error', { message: ev.message })
          notifyBackground(tr('notify.failedTitle'), ev.message)
        }
      }
    } catch (e) {
      this.emitError(e instanceof Error ? e.message : String(e))
    } finally {
      this.running.delete(sessionId)
      this.controllers.delete(sessionId)
      this.live.delete(sessionId)
      this.lastTaskMs.set(sessionId, Date.now() - taskStart)
      const finishedAt = new Date().toISOString()
      // Persist the assistant turn — but only if it produced something. An empty
      // turn (aborted during model selection / before any output) would replay
      // as an invalid empty assistant message (DeepSeek 400) next turn.
      if (asstText || toolMap.size > 0) {
        this.sessions?.append(
          sessionId,
          { role: 'assistant', text: asstText, tools: [...toolMap.values()] },
          finishedAt
        )
      }
      // Settlement receipt — only when real tokens were spent.
      if (task.requests > 0 && task.hit + task.miss + task.output > 0) {
        const fullPrice = task.fullPrice
        const saved = fullPrice - task.cost
        const receipt: TaskReceipt = {
          ts: finishedAt,
          taskName: text.slice(0, 80),
          model,
          hitTokens: task.hit,
          missTokens: task.miss,
          outputTokens: task.output,
          thinkingTokens: task.thinking,
          cost: task.cost,
          fullPrice: fullPrice,
          saved: saved,
          savedPct: fullPrice > 0 ? saved / fullPrice : 0,
          durationMs: Date.now() - taskStart,
          requests: task.requests,
        }
        this.sessions?.append(sessionId, { role: 'receipt', text: '', receipt }, finishedAt)
        this.send(IPC.agentReceipt, { sessionId, receipt })
        // 完成通知: cost in hand, only when the app is in the background.
        notifyBackground(
          tr('notify.doneTitle', { cost: task.cost.toFixed(4) }),
          tr('notify.doneBody', {
            text: text.slice(0, 60),
            saved: saved.toFixed(4),
            pct: Math.round(receipt.savedPct * 100),
          })
        )
        this.checkDayCost()
      }
      this.send(IPC.sessionChange)
      this.send(IPC.changesUpdate)
      void this.balance.refresh() // refresh after each task
      // refresh the session snapshot + distill project memory, off-thread.
      if (task.requests > 0) {
        this.scheduleMemoryWriters(sessionId, projectDir, context, registry, client, task.requests)
      }
      // All DB writes for this run are done — let a waiting rewind proceed.
      resolveRunDone()
      this.runDone.delete(sessionId)
    }
  }

  private async permit(
    policy: PolicyEngine,
    registry: ToolRegistry,
    projectDir: string,
    name: string,
    input: Record<string, unknown>
  ): Promise<PermitDecision> {
    const decision = policy.decide({ toolName: name, input, isReadOnly: registry.isReadOnly(name) })
    if (decision === 'allow') return 'allow'
    if (decision === 'deny') return 'deny'

    const dangerous = policy.classOf({ toolName: name, input, isReadOnly: false }) === 'dangerous'
    const grant = await this.ask({
      id: randomUUID(),
      tool: name,
      summary: this.summarize(name, input),
      dangerous,
    })
    if (grant === 'deny') return 'deny'
    if (grant === 'session') policy.addRule(name)
    if (grant === 'project') {
      policy.addRule(name)
      this.persistProjectAllow(projectDir, name)
    }
    return 'allow'
  }

  private ask(req: PermissionRequest): Promise<PermitGrant> {
    return new Promise((resolve) => {
      this.pending.set(req.id, resolve)
      this.send(IPC.permissionRequest, req)
      // 需回应通知: the task is blocked on the user.
      notifyBackground(tr('notify.confirmTitle'), `${req.tool}: ${req.summary}`)
    })
  }

  /** 当日费用阈值提醒: at most one notification per day. */
  private checkDayCost(): void {
    const threshold = this.settings.get('dayCostAlertYuan')
    if (threshold === null || !this.usage) return
    const today = new Date().toISOString().slice(0, 10)
    if (this.dayCostAlertedOn === today) return
    const todayCost = this.usage
      .byModel(`${today}T00:00:00.000Z`)
      .reduce((s, r) => s + this.priceOf(r).cost, 0)
    if (todayCost >= threshold) {
      this.dayCostAlertedOn = today
      notifyBackground(
        tr('notify.dayCostTitle'),
        tr('notify.dayCostBody', { cost: todayCost.toFixed(2) })
      )
    }
  }

  private persistProjectAllow(projectDir: string, tool: string): void {
    const all = this.settings.get('allowlist')
    const list = new Set(all[projectDir] ?? [])
    list.add(tool)
    this.settings.set('allowlist', { ...all, [projectDir]: [...list] })
  }

  private summarize(name: string, input: Record<string, unknown>): string {
    if (name === 'shell') return String(input.command ?? '')
    if (typeof input.path === 'string') return `${name} ${input.path}`
    return name
  }

  /**
   * The tool set for a project, frozen at session start (CACHING RULE 2): the
   * base tools plus a single `use_skill` tool when skills are available. Skill
   * bodies stay out of the prefix — only the loader tool does.
   *
   * Skill layering: global ~/.claude/skills (CC compat) and the
   * app-managed ~/.vibeseek/skills, then the project's own dirs — later roots
   * win on name collision, so a project skill overrides a same-named global one.
   */
  private globalSkillRoots(): string[] {
    return [join(homedir(), '.claude', 'skills'), join(homedir(), '.vibeseek', 'skills')]
  }

  private skillRoots(projectDir: string): string[] {
    return [
      ...this.globalSkillRoots(),
      join(projectDir, '.claude', 'skills'),
      join(projectDir, 'skills'),
    ]
  }

  /** Project tools WITHOUT the sub-agent tool — what a sub-agent itself runs
   *  with (no recursion) and the base the main set extends. Per-project
   *  disable lists filter skills and MCP tools here, which means they
   *  apply when a session's tool set is BUILT — new conversations only. */
  private toolsBaseFor(projectDir: string): Tool[] {
    const skillsOff = new Set(this.settings.get('skillsDisabled')[projectDir] ?? [])
    const skills = loadSkills(this.skillRoots(projectDir)).filter((s) => !skillsOff.has(s.name))
    const skillTool = makeSkillTool(skills)
    const mcpOff = this.settings.get('mcpDisabled')[projectDir] ?? []
    // Past the threshold, many MCP tools collapse into find/call gateway tools
    // (progressive discovery) — decided here, so frozen per conversation.
    const mcp = mcpGateway(
      (this.mcpToolsByProject.get(projectDir) ?? []).filter(
        (t) => !mcpOff.some((server) => t.def.name.startsWith(`mcp__${server}__`))
      )
    )
    const memoryTool = makeMemorySearchTool((query) => this.searchMemory(projectDir, query))
    return [...ALL_TOOLS, ...(skillTool ? [skillTool] : []), memoryTool, ...mcp]
  }

  /** Format FTS5 recall hits for the memory_search tool result. */
  private async searchMemory(projectDir: string, query: string): Promise<string> {
    const hits = this.sessions?.searchMessages(projectDir, query, 6) ?? []
    if (hits.length === 0) return ''
    return hits
      .map((h) => {
        const who = h.role === 'user' ? tr('mem.user') : 'VibeSeek'
        const when = h.ts.slice(0, 16).replace('T', ' ')
        const title = h.title || tr('untitled')
        return `[${title} · ${who} · ${when}]\n${h.snippet}`
      })
      .join('\n\n')
  }

  private toolsFor(projectDir: string, sessionId?: string): Tool[] {
    return [
      ...this.toolsBaseFor(projectDir),
      makeSubagentTool((task) => this.runSubagent(projectDir, task)),
      // 任务清单: main-thread only (next to dispatch_subagent, so the
      // sub-agent's shared base prefix is untouched). Same def every build —
      // cache rule 2 holds; only the callback's session binding differs.
      makeUpdatePlanTool((items) => this.setPlan(sessionId, items)),
    ]
  }

  /** Store + broadcast a session's plan (update_plan tool callback). */
  private setPlan(sessionId: string | undefined, items: PlanItem[]): void {
    if (!sessionId) return
    this.plans.set(sessionId, items)
    this.send(IPC.planUpdate, { sessionId })
  }

  /** The viewed session's plan for the 任务清单 panel. */
  planFor(): PlanItem[] {
    return this.currentSessionId ? (this.plans.get(this.currentSessionId) ?? []) : []
  }

  /**
   * Run a read-only flash sub-agent: it explores in its OWN context and
   * returns only a summary, so the main thread doesn't bloat. Shares the main
   * session's cached stable prefix (same SYSTEM_PROMPT + base tool defs),
   * so its first turn isn't a full miss. Writes/commands are denied; usage is
   * recorded to the active session so receipts/dashboard account for it.
   */
  private async runSubagent(projectDir: string, task: string): Promise<string> {
    const apiKey = this.keys.get()
    if (!apiKey) return tr('sub.noKey')
    const client = new ProviderClient({ baseUrl: this.settings.get('baseUrl'), apiKey })
    const registry = new ToolRegistry(this.toolsBaseFor(projectDir))
    const context = new SessionContext({
      systemPrompt: SYSTEM_PROMPT,
      tools: registry.defs(),
      contextMessage: this.buildContextMessage(projectDir),
    })
    const model = this.models.defaultModel // flash
    const pricing = this.models.get(model).pricing
    const attributeTo = this.currentSessionId
    const loop = new AgentLoop({
      streamer: client,
      registry,
      context,
      toolContext: { cwd: projectDir, shell: this.shell },
      model,
      thinking: 'off',
      maxIterations: 12,
      // Read-only: deny anything that mutates (the sub-agent only investigates).
      permit: async (name) => (registry.isReadOnly(name) ? 'allow' : 'deny'),
    })
    let text = ''
    try {
      for await (const ev of loop.run(task)) {
        if (ev.type === 'text') text += ev.delta
        else if (ev.type === 'usage' && attributeTo) {
          this.usage?.record(model, ev.usage, pricing, attributeTo)
        } else if (ev.type === 'tool_start' && attributeTo) {
          // Sub-agent visibility (backlog item): surface what it's doing as an
          // ephemeral line on the running indicator — not a transcript entry.
          const detail = String(ev.input.path ?? ev.input.pattern ?? ev.input.command ?? '')
          this.send(IPC.subagentActivity, {
            sessionId: attributeTo,
            text: `${ev.name} ${detail}`.trim().slice(0, 80),
          })
        }
      }
    } finally {
      if (attributeTo) this.send(IPC.subagentActivity, { sessionId: attributeTo, text: '' })
    }
    return text.trim()
  }

  /** Parse `<project>/.mcp.json` (standard `mcpServers` map; missing = none). */
  private readMcpConfig(projectDir: string): Record<string, McpServerConfig> {
    const file = join(projectDir, '.mcp.json')
    if (!existsSync(file)) return {}
    try {
      const j = JSON.parse(readFileSync(file, 'utf8')) as {
        mcpServers?: Record<string, McpServerConfig>
      }
      return j.mcpServers ?? {}
    } catch {
      return {}
    }
  }

  /** Connect a project's MCP servers once; cache their wrapped tools. */
  private ensureMcp(projectDir: string): Promise<void> {
    let p = this.mcpReady.get(projectDir)
    if (!p) {
      p = this.connectMcp(projectDir)
      this.mcpReady.set(projectDir, p)
    }
    return p
  }

  private async connectMcp(projectDir: string): Promise<void> {
    const servers = this.readMcpConfig(projectDir)
    const tools: Tool[] = []
    const clients: McpClient[] = []
    const previous = this.mcpClients.get(projectDir)
    if (previous) this.retiredMcpClients.push(...previous)
    for (const [name, cfg] of Object.entries(servers)) {
      // stdio (command) for local servers, streamable HTTP (url) for hosted ones.
      const transport = cfg.command
        ? new StdioTransport(cfg)
        : cfg.url
          ? new HttpTransport(cfg)
          : null
      if (!transport) continue
      try {
        const client = new McpClient(name, transport)
        await client.connect()
        tools.push(...mcpTools(client, await client.listTools()))
        clients.push(client)
      } catch (e) {
        this.logger.appWarn('mcp connect failed', {
          name,
          message: e instanceof Error ? e.message : String(e),
        })
      }
    }
    this.mcpClients.set(projectDir, clients)
    this.mcpToolsByProject.set(projectDir, tools)
  }

  /** Configured MCP servers + live status (设置→MCP). */
  mcpStatus(): Array<{ name: string; command: string; connected: boolean; toolCount: number }> {
    const dir = this.settings.get('projectDir')
    if (!dir) return []
    const servers = this.readMcpConfig(dir)
    const clients = this.mcpClients.get(dir) ?? []
    const tools = this.mcpToolsByProject.get(dir) ?? []
    return Object.entries(servers).map(([name, cfg]) => ({
      name,
      command: cfg.command ? [cfg.command, ...(cfg.args ?? [])].join(' ') : (cfg.url ?? ''),
      connected: clients.some((c) => c.name === name),
      toolCount: tools.filter((t) => t.def.name.startsWith(`mcp__${name}__`)).length,
    }))
  }

  /** Close all MCP child processes (app quit). */
  disposeMcp(): void {
    for (const clients of this.mcpClients.values()) for (const c of clients) c.close()
    for (const c of this.retiredMcpClients) c.close()
    this.retiredMcpClients.length = 0
    this.mcpClients.clear()
    this.mcpToolsByProject.clear()
    this.mcpReady.clear()
  }

  /** Skills available to the current project (设置→技能 transparency).
   *  Returns ALL discovered skills (the per-project disable list lives in
   *  settings; the UI shows toggles, the composer menu filters). */
  listSkills(): SkillInfo[] {
    const dir = this.settings.get('projectDir')
    if (!dir) return []
    const globals = this.globalSkillRoots()
    return loadSkills(this.skillRoots(dir)).map((s) => ({
      name: s.name,
      description: s.description,
      source: s.source,
      scope: globals.some((root) => s.source.startsWith(root)) ? 'global' : 'project',
    }))
  }

  /** Import a skill folder (must contain SKILL.md) into ~/.vibeseek/skills. */
  async importSkill(): Promise<{ ok: boolean; name?: string; error?: 'noSkillMd' }> {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    const src = res.filePaths[0]
    if (res.canceled || !src) return { ok: false }
    if (!existsSync(join(src, 'SKILL.md'))) return { ok: false, error: 'noSkillMd' }
    const destRoot = join(homedir(), '.vibeseek', 'skills')
    mkdirSync(destRoot, { recursive: true })
    cpSync(src, join(destRoot, basename(src)), { recursive: true })
    return { ok: true, name: basename(src) }
  }

  /** Open the app-managed global skills folder in the file explorer. */
  openSkillsDir(): void {
    const dir = join(homedir(), '.vibeseek', 'skills')
    mkdirSync(dir, { recursive: true })
    void shell.openPath(dir)
  }

  /** Append a server to the project's .mcp.json (设置→MCP 添加表单).
   *  The cached connect-promise is dropped so the NEXT conversation connects
   *  with the new set; servers already running keep serving open sessions. */
  addMcpServer(name: string, command: string, argsLine: string): boolean {
    const dir = this.settings.get('projectDir')
    if (!dir || !name.trim() || !command.trim()) return false
    const servers = this.readMcpConfig(dir)
    servers[name.trim()] = {
      command: command.trim(),
      args: argsLine.trim() ? argsLine.trim().split(/\s+/) : [],
    }
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: servers }, null, 2) + '\n',
      'utf8'
    )
    this.mcpReady.delete(dir)
    return true
  }

  /** Build a fresh SessionContext, optionally replaying persisted messages. */
  private buildContext(
    projectDir: string,
    history: PersistedMessage[] = [],
    sessionId?: string
  ): SessionContext {
    const registry = new ToolRegistry(this.toolsFor(projectDir, sessionId))
    const ctx = new SessionContext({
      systemPrompt: SYSTEM_PROMPT,
      tools: registry.defs(),
      // buildContextMessage updates repoModeActive[projectDir] as a side effect.
      contextMessage: this.buildContextMessage(projectDir),
    })
    for (const m of history) {
      for (const block of toMessages(m)) ctx.append(block)
    }
    // Lock this session's whole-repo state for its life (the badge reads it).
    if (sessionId) {
      const on = !!this.settings.get('repoMode')[projectDir]
      this.sessionRepo.set(sessionId, on && !!this.repoModeActive.get(projectDir))
    }
    return ctx
  }

  /** Semi-stable first user message: dynamic content is allowed here. */
  private buildContextMessage(projectDir: string): string {
    const date = new Date().toISOString().slice(0, 10)
    const tree = shallowTree(projectDir)
    const parts = [
      `Date: ${date}`,
      `Project root: ${projectDir}`,
      '',
      'Top-level files and directories:',
      tree,
    ]
    // rule 1: memory is injected ONLY at session start (semi-stable
    // layer) — never per turn, which would disturb the prefix.
    if (this.settings.get('memoryEnabled') !== false) {
      // Global personalization goes first — it's the most stable layer (shared
      // across every project), so the cache prefix is reused project-to-project.
      let globalMem: string | null = null
      try {
        globalMem = new ProjectMemory(homedir()).readMemory()
      } catch {
        globalMem = null
      }
      if (globalMem) {
        parts.push('', tr('ctx.memoryGlobalHeader'), globalMem.slice(0, 4_000))
      }
      let memory: string | null = null
      try {
        memory = new ProjectMemory(projectDir).readMemory()
      } catch {
        memory = null
      }
      if (memory) {
        parts.push('', tr('ctx.memoryHeader'), memory.slice(0, 6_000))
      }
    }
    // 全库模式: the whole repo goes into this semi-stable layer so it's
    // cached after turn 1 — the model then has every file and stops grepping.
    // Over budget → stays in normal mode (digest reports truncated).
    if (this.settings.get('repoMode')[projectDir]) {
      const digest = buildRepoDigest(projectDir)
      if (!digest.truncated && digest.fileCount > 0) {
        parts.push(
          '',
          tr('ctx.repoHeader', {
            files: digest.fileCount,
            kt: Math.round(digest.tokenEstimate / 1000),
          }),
          digest.text
        )
      }
      this.repoModeActive.set(projectDir, !digest.truncated && digest.fileCount > 0)
      this.repoModeDigest.set(projectDir, digest)
    }
    return parts.join('\n')
  }

  /** 全库模式 status of the active project for the composer toggle. */
  repoModeInfo(): {
    on: boolean
    active: boolean
    sessionActive: boolean
    fileCount: number
    tokens: number
    truncated: boolean
  } {
    const dir = this.settings.get('projectDir')
    const on = dir ? !!this.settings.get('repoMode')[dir] : false
    const digest = dir ? this.repoModeDigest.get(dir) : undefined
    return {
      on,
      active: dir ? !!this.repoModeActive.get(dir) : false,
      sessionActive: this.currentSessionId ? !!this.sessionRepo.get(this.currentSessionId) : false,
      fileCount: digest?.fileCount ?? 0,
      tokens: digest?.tokenEstimate ?? 0,
      truncated: digest?.truncated ?? false,
    }
  }

  /** Toggle 全库模式 for the active project (takes effect on the next conversation). */
  setRepoMode(on: boolean): void {
    const dir = this.settings.get('projectDir')
    if (!dir) return
    this.settings.set('repoMode', { ...this.settings.get('repoMode'), [dir]: on })
  }

  // ---------- file panel ----------

  /** Resolve a project-relative path, refusing anything that escapes the root. */
  private safeResolve(rel: string): string | null {
    const root = this.settings.get('projectDir')
    if (!root) return null
    const abs = resolve(root, rel)
    const rootAbs = resolve(root)
    if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) return null
    return abs
  }

  /** List a directory (''=root) for the file panel: dirs first, then files. */
  listDir(rel: string): DirEntry[] {
    const abs = this.safeResolve(rel || '.')
    if (!abs) return []
    let entries: Dirent[]
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      return []
    }
    return entries
      .filter((e) => !IGNORED.has(e.name))
      .map((e) => ({
        name: e.name,
        path: rel ? `${rel}/${e.name}` : e.name,
        isDir: e.isDirectory(),
      }))
      .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
  }

  /** Read a project file for the preview pane (size-capped, binary-detected). */
  readProjectFile(rel: string): FilePreview {
    const empty: FilePreview = {
      path: rel,
      content: '',
      truncated: false,
      binary: false,
      tooLarge: false,
    }
    const abs = this.safeResolve(rel)
    if (!abs) return empty
    let size: number
    try {
      size = statSync(abs).size
    } catch {
      return empty
    }
    if (size > 512 * 1024) return { ...empty, tooLarge: true }
    const buf = readFileSync(abs)
    // Binary sniff: a NUL byte in the first 8KB means "don't render as text".
    if (buf.subarray(0, 8192).includes(0)) return { ...empty, binary: true }
    const MAX_LINES = 2000
    const lines = buf.toString('utf8').split('\n')
    const truncated = lines.length > MAX_LINES
    return { ...empty, content: lines.slice(0, MAX_LINES).join('\n'), truncated }
  }

  /** Pick a file via dialog and read it as text — the composer "+" attachment.
   *  DeepSeek is text-only today, so this inlines text/code; images are not
   *  sent (the UI offers an image slot but disabled until a vision model). */
  async attachFile(): Promise<{ name: string; content: string } | null> {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'] })
    if (res.canceled || res.filePaths.length === 0) return null
    const p = res.filePaths[0]
    try {
      const buf = readFileSync(p)
      if (buf.subarray(0, 8192).includes(0)) return null // binary — nothing useful to inline
      const MAX = 100_000
      const raw = buf.toString('utf8')
      const content = raw.length > MAX ? `${raw.slice(0, MAX)}\n…(truncated)` : raw
      return { name: basename(p), content }
    } catch {
      return null
    }
  }

  private sendMeter(): void {
    // Live session → its meter. No session but a project selected → that
    // project's accumulated totals (status bar reads as "本项目"). Neither → zero.
    if (this.currentSessionId) {
      const m = this.meters.get(this.currentSessionId)
      this.send(IPC.meterUpdate, {
        scope: 'session',
        sessionCost: m?.cost ?? 0,
        saved: m?.savings ?? 0,
        sessionHitRate: m?.acc.rate ?? 0,
        contextPercent: 0,
        sessionTokens: m?.tokens ?? 0,
      })
      return
    }
    const dir = this.settings.get('projectDir')
    const r = dir ? this.receiptFor({ scope: 'project', id: dir }) : null
    if (dir && r) {
      const inOut = r.hitTokens + r.missTokens
      this.send(IPC.meterUpdate, {
        scope: 'project',
        sessionCost: r.cost,
        saved: r.saved,
        sessionHitRate: inOut > 0 ? r.hitTokens / inOut : 0,
        contextPercent: 0,
        sessionTokens: r.hitTokens + r.missTokens + r.outputTokens,
      })
      return
    }
    this.send(IPC.meterUpdate, {
      scope: dir ? 'project' : 'none',
      sessionCost: 0,
      saved: 0,
      sessionHitRate: 0,
      contextPercent: 0,
      sessionTokens: 0,
    })
  }

  private emitError(message: string): void {
    const sessionId = this.currentSessionId ?? 'none'
    this.send(IPC.agentEvent, {
      sessionId,
      event: { type: 'error', message } satisfies LoopEvent,
    })
    this.send(IPC.agentEvent, {
      sessionId,
      event: { type: 'done', finalText: '', aborted: false } satisfies LoopEvent,
    })
  }

  private send(channel: string, payload?: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }
}

/** Convert a persisted message back into cache-friendly core Messages. */
/**
 * Consecutive-day streak ending today (or yesterday, so a not-yet-active today
 * doesn't reset it). Dates are UTC 'YYYY-MM-DD' to match the stored ISO ts.
 */
function streakOf(days: string[]): number {
  const set = new Set(days)
  const iso = (d: Date): string => d.toISOString().slice(0, 10)
  const cursor = new Date()
  if (!set.has(iso(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1)
  let streak = 0
  while (set.has(iso(cursor))) {
    streak++
    cursor.setUTCDate(cursor.getUTCDate() - 1)
  }
  return streak
}

/** Longest consecutive-day run anywhere in history (days sorted ascending). */
function longestStreakOf(days: string[]): number {
  let best = 0
  let run = 0
  let prev = ''
  for (const day of days) {
    const prevDate = new Date(day + 'T00:00:00Z')
    prevDate.setUTCDate(prevDate.getUTCDate() - 1)
    run = prev === prevDate.toISOString().slice(0, 10) ? run + 1 : 1
    if (run > best) best = run
    prev = day
  }
  return best
}

function toMessages(m: PersistedMessage): Message[] {
  if (m.role === 'user') {
    return [{ role: 'user', content: [{ type: 'text', text: m.text }] }]
  }
  if (m.role === 'assistant') {
    const blocks: ContentBlock[] = []
    if (m.text) blocks.push({ type: 'text', text: m.text })
    for (const t of m.tools ?? []) {
      blocks.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input })
    }
    // An empty assistant turn (aborted before any output) must NOT be replayed:
    // DeepSeek rejects an assistant message with neither content nor tool_calls
    // (HTTP 400). Skip it — and any stray tool_results that would pair with it.
    if (blocks.length === 0) return []
    const out: Message[] = [{ role: 'assistant', content: blocks }]
    const results: ContentBlock[] = (m.tools ?? [])
      .filter((t) => t.result)
      .map((t) => ({
        type: 'tool_result',
        toolUseId: t.id,
        content: t.result!.content,
        isError: t.result!.isError,
      }))
    if (results.length) out.push({ role: 'user', content: results })
    return out
  }
  return [] // error rows aren't replayed into model context
}

const IGNORED = new Set(['node_modules', '.git', 'dist', 'out', '.vite', 'release'])

/** A shallow (2-level) listing of the project for the context message. */
function shallowTree(root: string, limit = 200): string {
  const lines: string[] = []
  let count = 0
  const walk = (dir: string, depth: number): void => {
    if (depth > 1 || count >= limit) return
    let entries: string[]
    try {
      entries = readdirSync(dir).sort()
    } catch {
      return
    }
    for (const name of entries) {
      if (IGNORED.has(name) || name.startsWith('.')) continue
      if (count >= limit) break
      const full = join(dir, name)
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        continue
      }
      const rel = relative(root, full).split(sep).join('/')
      lines.push(isDir ? `${rel}/` : rel)
      count++
      if (isDir) walk(full, depth + 1)
    }
  }
  walk(root, 0)
  return lines.join('\n')
}
