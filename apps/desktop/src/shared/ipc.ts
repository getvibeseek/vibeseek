import type { Settings } from './settings'
import type { BalanceState, LoopEvent } from '@vibeseek/core'

export type {
  BalanceState,
  BalanceResult,
  BalanceInfo,
  LoopEvent,
  MemoryFileInfo,
} from '@vibeseek/core'
import type { MemoryFileInfo } from '@vibeseek/core'

export interface ApiKeyStatus {
  hasKey: boolean
  masked: string | null
}

/** One agent event tagged with its session. */
export interface AgentEventMsg {
  sessionId: string
  event: LoopEvent
}

/** A file touched during the current task (for the Changes panel). */
export interface FileChange {
  path: string
  status: 'created' | 'modified'
  added: number
  removed: number
  accepted: boolean
}

/** One rendered line of a unified diff; 'gap' = collapsed unchanged run. */
export interface DiffRow {
  type: 'ctx' | 'add' | 'del' | 'gap'
  text: string
  oldNo?: number
  newNo?: number
  /** Index of the contiguous changed run this add/del line belongs to. */
  hunk?: number
}

export interface FileDiff {
  path: string
  rows: DiffRow[]
}

/** A tool call as persisted/replayed in a conversation. */
export interface PersistedTool {
  id: string
  name: string
  input: Record<string, unknown>
  result?: { content: string; isError?: boolean }
}

/** Per-model line on an aggregate receipt (flash vs pro 各花了多少). */
export interface ReceiptModelLine {
  model: string
  requests: number
  hitTokens: number
  missTokens: number
  outputTokens: number
  thinkingTokens: number
  cost: number
}

/**
 * Task settlement receipt (signature element). Emitted when a task
 * completes and rendered as a ledger-aesthetic card in the conversation.
 */
export interface TaskReceipt {
  ts: string
  taskName: string
  model: string
  hitTokens: number
  missTokens: number
  outputTokens: number
  thinkingTokens: number
  cost: number
  /** What the same work would cost with zero cache hits. */
  fullPrice: number
  saved: number
  /** 0..1 — saved / fullPrice. */
  savedPct: number
  durationMs: number
  requests: number
  /** Present on aggregate receipts with 2+ models — the per-model split. */
  byModel?: ReceiptModelLine[]
}

/** One stored message in a conversation (maps to a transcript item). */
export interface PersistedMessage {
  role: 'user' | 'assistant' | 'error' | 'receipt'
  text: string
  reasoning?: string
  tools?: PersistedTool[]
  receipt?: TaskReceipt
  /** Stored submit/finish time (ISO) — shown in the message hover toolbar. */
  ts?: string
  /** Stable DB row id — the anchor for rewind/fork (set on read). */
  id?: number
  /** On a user turn: the git shadow commit captured before that task ran,
   *  so rewinding to this message can restore the working tree. */
  checkpoint?: string
}

/** Sidebar conversation entry. */
export interface SessionMeta {
  id: string
  title: string
  updatedAt: string
}

/** One conversation hit from the sidebar search (across all projects). */
export interface SessionSearchResult {
  id: string
  projectDir: string
  title: string
  snippet: string
  updatedAt: string
}

/** Per-model usage line for the usage popover (起步版). */
export interface ModelUsageLine {
  model: string
  requests: number
  hitTokens: number
  missTokens: number
  outputTokens: number
  thinkingTokens: number
  cost: number
  saved: number
}

/** What a settlement receipt covers (右键谁开谁的票；month=月度账单). */
export interface ReceiptScope {
  scope: 'session' | 'project' | 'month'
  /** session id, project dir, or 'YYYY-MM'. */
  id: string
}

/** Aggregated usage for the bottom-left usage popover. */
export interface UsageSummary {
  todayCost: number
  totalCost: number
  totalSaved: number
  byModel: ModelUsageLine[]
}

/** One day's activity intensity for the achievement-page heatmap. */
export interface DayActivity {
  /** Local date, 'YYYY-MM-DD'. */
  day: string
  requests: number
}

/**
 * Achievement-page / dashboard headline stats. All figures are priced at
 * current registry rates, so a price correction retroactively fixes them.
 */
export interface DashboardStats {
  monthSaved: number
  monthCost: number
  totalSaved: number
  totalCost: number
  /** Overall cache hit rate, hit/(hit+miss), 0..1. */
  hitRate: number
  sessions: number
  requests: number
  totalTokens: number
  /** Distinct days with any activity (all time). */
  activeDays: number
  /** Consecutive-day streak ending today or yesterday. */
  streak: number
  /** Last ~17 weeks, oldest first — for the contribution-style heatmap. */
  heatmap: DayActivity[]
  /** Busiest local hour of day (0-23), or null with no data. */
  peakHour: number | null
  /** Model with the most requests, or null with no data. */
  topModel: string | null
}

/** One day's tokens for one model — stacked daily chart series. */
export interface ModelDayTokens {
  day: string
  model: string
  tokens: number
}

/** A conversation's cost line in the ranking. */
export interface SessionCostLine {
  id: string
  title: string
  cost: number
  requests: number
}

/** One request's token split — the per-session cost timeline bars. */
export interface RequestCostPoint {
  ts: string
  model: string
  hit: number
  miss: number
  output: number
}

/** Range-scoped dashboard payload (完整版). */
export interface DashboardData {
  /** null = all time. */
  rangeDays: number | null
  cost: number
  saved: number
  hitRate: number
  tokens: number
  requests: number
  /** Conversations with activity in range. */
  sessions: number
  /** Stored messages in range. */
  messages: number
  /** All-time figures (GitHub-style, not range-scoped). */
  activeDays: number
  streak: number
  longestStreak: number
  heatmap: DayActivity[]
  models: ModelUsageLine[]
  daily: ModelDayTokens[]
  topSessions: SessionCostLine[]
}

/** Project-scoped stats for the project home view (点击项目时显示). */
export interface ProjectStats {
  dir: string
  sessions: number
  messages: number
  requests: number
  tokens: number
  cost: number
  saved: number
  hitRate: number
  models: ModelUsageLine[]
  /** This project's own activity heatmap (same window as the global one). */
  heatmap: DayActivity[]
}

/** One model turn as recorded for the developer panel. */
export interface DevTurn {
  ts: string
  model: string
  hit: number
  miss: number
  output: number
  /** Cache hit rate of this turn, hit/(hit+miss), 0..1. */
  rate: number
}

/** One prefix-drift incident recorded for the developer panel. */
export interface DevDrift {
  ts: string
  layer: 'system' | 'tools'
  /** First differing character index in the canonical serialization. */
  at: number
}

/** Developer-panel snapshot of the current session (Ctrl+Shift+D). */
export interface DevInfo {
  sessionId: string | null
  /** Locked stable-layer fingerprints (sha256 hex), or null with no context yet. */
  systemFp: string | null
  toolsFp: string | null
  turns: DevTurn[]
  drifts: DevDrift[]
}

/** Right-side 概览 panel snapshot (吸收 Reasonix ContextPanel). */
export interface OverviewInfo {
  sessionId: string | null
  /** Estimated tokens currently occupying the context window. */
  contextTokens: number
  contextWindow: number
  /** Cumulative session token sums (from usage_log — survive restarts). */
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  requests: number
  /** Session cost figures at current registry prices (¥). */
  cost: number
  saved: number
  hitRate: number
  /** Wall time of the last finished task, ms. */
  lastTaskMs: number | null
  running: boolean
  /** Last compaction time of this session (ISO), or null. */
  compactedAt: string | null
  /** Last checkpoint snapshot time (ISO), or null. */
  checkpointAt: string | null
}

/** One entry in the file panel's directory tree. */
export interface DirEntry {
  name: string
  /** Path relative to the project root, '/'-separated. */
  path: string
  isDir: boolean
}

/** A file's content for the preview pane, or a reason it can't be shown. */
export interface FilePreview {
  path: string
  content: string
  /** Content was cut to a line/byte cap. */
  truncated: boolean
  /** Looks binary (has NUL bytes) — not rendered as text. */
  binary: boolean
  /** Over the preview size ceiling. */
  tooLarge: boolean
}

/** A skill available to the agent in the current project. */
export interface SkillInfo {
  name: string
  description: string
  source: string
  /** Where it was discovered: the project's own dirs, or a global root. */
  scope: 'project' | 'global'
}

/** One step of the agent's visible task plan (任务清单, mirrors core). */
export interface PlanItemInfo {
  text: string
  status: 'pending' | 'in_progress' | 'done'
}

/** A configured MCP server and its live status. */
export interface McpStatus {
  name: string
  command: string
  connected: boolean
  toolCount: number
}

/** Live session meter for the status bar (cost in USD). */
export interface MeterUpdate {
  /** Whose numbers these are: the live session, the selected project, or none. */
  scope: 'session' | 'project' | 'none'
  sessionCost: number
  saved: number
  sessionHitRate: number
  contextPercent: number
  sessionTokens: number
}

/** A pending tool confirmation surfaced to the user. */
export interface PermissionRequest {
  id: string
  tool: string
  summary: string
  dangerous: boolean
}

/** User's answer to a permission request. */
export type PermitGrant = 'once' | 'session' | 'project' | 'deny'

/**
 * The typed surface exposed to the renderer via preload contextBridge.
 * Renderer code calls `window.api.*`; main registers matching ipcMain handlers.
 */
export interface AppApi {
  /** Host OS, from process.platform (e.g. 'darwin', 'win32'). */
  platform: NodeJS.Platform
  window: {
    minimize(): void
    maximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
  }
  settings: {
    getAll(): Promise<Settings>
    set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>
  }
  apiKey: {
    set(key: string): Promise<ApiKeyStatus>
    status(): Promise<ApiKeyStatus>
    clear(): Promise<void>
  }
  balance: {
    get(): Promise<BalanceState>
    onUpdate(cb: (state: BalanceState) => void): () => void
  }
  project: {
    pick(): Promise<string | null>
    get(): Promise<string | null>
    recents(): Promise<string[]>
    switch(dir: string): Promise<void>
    openInExplorer(dir: string): void
    removeRecent(dir: string): Promise<void>
    onChange(cb: () => void): () => void
  }
  receipt: {
    /** Aggregate settlement receipt for a conversation or a whole project. */
    get(target: ReceiptScope): Promise<TaskReceipt | null>
  }
  session: {
    /** Sessions of one project dir (defaults to the current project). */
    list(dir?: string): Promise<SessionMeta[]>
    /** Create in a specific project (switches to it) or the current one. */
    create(dir?: string): Promise<string>
    select(id: string): Promise<PersistedMessage[]>
    current(): Promise<string | null>
    rename(id: string, title: string): Promise<void>
    /** Clear the selection — composer becomes a draft; send creates a new conversation. */
    deselect(): Promise<void>
    /** Read a conversation's messages WITHOUT selecting it (复制对话 etc.). */
    peek(id: string): Promise<PersistedMessage[]>
    /** Search conversations across all projects by title/content (sidebar 搜索). */
    search(query: string): Promise<SessionSearchResult[]>
    /** Branch a new conversation from messages up to (incl.) messageId; returns its id. */
    fork(sessionId: string, messageId: number): Promise<string | null>
    /** Truncate at messageId (removes it + everything after) and restore the
     *  working tree to that turn's checkpoint; returns the remaining messages. */
    rewind(sessionId: string, messageId: number): Promise<PersistedMessage[]>
    remove(id: string): Promise<void>
    onChange(cb: () => void): () => void
  }
  usage: {
    summary(): Promise<UsageSummary>
    /** Headline stats for the achievement page / dashboard. */
    stats(): Promise<DashboardStats>
    /** Range-scoped dashboard payload (null = all time). */
    dashboard(rangeDays: number | null): Promise<DashboardData>
    /** Per-request cost timeline of one conversation. */
    timeline(sessionId: string): Promise<RequestCostPoint[]>
    /** Project-scoped stats (project home view). */
    projectStats(dir: string): Promise<ProjectStats>
    /** Wipe all usage history (settings → reset stats). Irreversible. */
    reset(): Promise<void>
  }
  agent: {
    send(text: string): Promise<void>
    abort(): void
    /** Whether a session has a task in flight + its streamed-so-far partial. */
    runningState(sessionId: string): Promise<{
      running: boolean
      text: string
      tools: PersistedTool[]
      startedAt: number | null
      model: string
    }>
    onEvent(cb: (msg: AgentEventMsg) => void): () => void
    onReceipt(cb: (msg: { sessionId: string; receipt: TaskReceipt }) => void): () => void
    /** Ephemeral sub-agent activity line ('' = sub-agent finished). */
    onSubagentActivity(cb: (msg: { sessionId: string; text: string }) => void): () => void
  }
  changes: {
    list(): Promise<FileChange[]>
    diff(path: string): Promise<FileDiff>
    /** Adopt the current content as the new baseline (row leaves the list). */
    accept(path: string): Promise<void>
    /** Restore the file to its pre-change content (one-step undoable). */
    reject(path: string): Promise<void>
    /** Path of the most recent reject that can still be undone, or null. */
    rejectedPath(): Promise<string | null>
    /** Undo the last reject (write the discarded content back, re-track). */
    undoReject(): Promise<void>
    /** Revert one hunk only; other changes stay. */
    rejectHunk(path: string, hunk: number): Promise<void>
    /** Adopt one hunk into the baseline; disk untouched. */
    acceptHunk(path: string, hunk: number): Promise<void>
    onUpdate(cb: () => void): () => void
  }
  permission: {
    onRequest(cb: (req: PermissionRequest) => void): () => void
    respond(id: string, grant: PermitGrant): void
  }
  git: {
    isRepo(): Promise<boolean>
    init(): Promise<void>
    /** Current branch of the project repo, or null (no repo / detached). */
    branch(): Promise<string | null>
    rollbackTask(): Promise<boolean>
    /** Whether a 恢复改动 (undo the rollback) is available for the current session. */
    canRedo(): Promise<boolean>
    /** Roll the working tree forward to before the last 回滚. */
    redoRollback(): Promise<boolean>
  }
  meter: {
    onUpdate(cb: (m: MeterUpdate) => void): () => void
  }
  logs: {
    openDir(): void
    reportError(message: string, meta?: unknown): void
  }
  diagnostics: {
    /** Export the diagnostics zip; resolves to the saved path or null. */
    export(): Promise<string | null>
  }
  dev: {
    /** Developer-panel snapshot of the current session. */
    info(): Promise<DevInfo>
  }
  overview: {
    /** Right-side 概览 panel snapshot of the current session. */
    info(): Promise<OverviewInfo>
  }
  fs: {
    /** List a project directory (''=root) for the file panel tree. */
    listDir(relPath: string): Promise<DirEntry[]>
    /** Read a project file for the preview pane. */
    readFile(relPath: string): Promise<FilePreview>
    /** Pick a file via dialog and read it as text (composer attachment). */
    attach(): Promise<{ name: string; content: string } | null>
  }
  skills: {
    /** Skills available to the current project (project + global roots). */
    list(): Promise<SkillInfo[]>
    /** Pick a folder containing SKILL.md and copy it into ~/.vibeseek/skills. */
    import(): Promise<{ ok: boolean; name?: string; error?: 'noSkillMd' }>
    /** Open ~/.vibeseek/skills in the file explorer. */
    openDir(): void
  }
  mcp: {
    /** Configured MCP servers + live connection status (设置→MCP). */
    status(): Promise<McpStatus[]>
    /** Append a server to the project's .mcp.json (next conversation connects). */
    add(name: string, command: string, args: string): Promise<boolean>
  }
  plan: {
    /** The viewed session's task plan (任务清单面板). */
    get(): Promise<PlanItemInfo[]>
    /** Fired when any session's plan changes; re-fetch via get(). */
    onUpdate(cb: () => void): () => void
  }
  shell: {
    /** Open an http(s) link in the system browser (markdown links). */
    openExternal(url: string): void
  }
  preview: {
    /** Show the embedded dev-server view at the given renderer rect (CSS px). */
    show(bounds: { x: number; y: number; width: number; height: number }, url?: string): void
    /** Track panel resize/move. */
    setBounds(bounds: { x: number; y: number; width: number; height: number }): void
    navigate(url: string): void
    reload(): void
    hide(): void
    /** Probe common local dev ports; resolves the first live URL or null. */
    detect(): Promise<string | null>
    /** Currently loaded URL (for restoring the address bar). */
    currentUrl(): Promise<string>
  }
  repo: {
    /** 全库模式 status of the active project. */
    info(): Promise<{
      on: boolean
      active: boolean
      /** Whether the CURRENT conversation was built with the whole repo. */
      sessionActive: boolean
      fileCount: number
      tokens: number
      truncated: boolean
    }>
    /** Toggle 全库模式 for the active project (applies to the next conversation). */
    setMode(on: boolean): Promise<void>
  }
  memory: {
    /** Memory files of a scope (project .vibeseek/, or global ~/.vibeseek/). */
    list(scope?: MemoryScope): Promise<MemoryFileInfo[]>
    read(name: string, scope?: MemoryScope): Promise<string>
    write(name: string, content: string, scope?: MemoryScope): Promise<void>
    remove(name: string, scope?: MemoryScope): Promise<void>
  }
}

/** Memory tier: per-project (auto-distilled) or global (manual, cross-project). */
export type MemoryScope = 'project' | 'global'

/** IPC channel names. Keep in one place so main/preload never drift. */
export const IPC = {
  windowMinimize: 'window:minimize',
  windowMaximize: 'window:maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:isMaximized',
  windowMaximizeChange: 'window:maximizeChange',
  settingsGetAll: 'settings:getAll',
  settingsSet: 'settings:set',
  apiKeySet: 'apiKey:set',
  apiKeyStatus: 'apiKey:status',
  apiKeyClear: 'apiKey:clear',
  balanceGet: 'balance:get',
  balanceUpdate: 'balance:update',
  projectPick: 'project:pick',
  projectGet: 'project:get',
  projectRecents: 'project:recents',
  projectSwitch: 'project:switch',
  projectOpenExplorer: 'project:openExplorer',
  projectRemoveRecent: 'project:removeRecent',
  projectChange: 'project:change',
  receiptGet: 'receipt:get',
  sessionList: 'session:list',
  sessionCreate: 'session:create',
  sessionSelect: 'session:select',
  sessionCurrent: 'session:current',
  sessionRename: 'session:rename',
  sessionRemove: 'session:remove',
  sessionDeselect: 'session:deselect',
  sessionPeek: 'session:peek',
  sessionSearch: 'session:search',
  sessionFork: 'session:fork',
  sessionRewind: 'session:rewind',
  sessionChange: 'session:change',
  usageSummary: 'usage:summary',
  usageStats: 'usage:stats',
  usageDashboard: 'usage:dashboard',
  usageTimeline: 'usage:timeline',
  usageProjectStats: 'usage:projectStats',
  usageReset: 'usage:reset',
  agentSend: 'agent:send',
  agentAbort: 'agent:abort',
  agentRunningState: 'agent:runningState',
  agentEvent: 'agent:event',
  agentReceipt: 'agent:receipt',
  changesList: 'changes:list',
  changesDiff: 'changes:diff',
  changesAccept: 'changes:accept',
  changesReject: 'changes:reject',
  changesRejectedPath: 'changes:rejectedPath',
  changesUndoReject: 'changes:undoReject',
  changesUpdate: 'changes:update',
  permissionRequest: 'permission:request',
  permissionRespond: 'permission:respond',
  meterUpdate: 'meter:update',
  gitIsRepo: 'git:isRepo',
  gitInit: 'git:init',
  gitBranch: 'git:branch',
  gitCanRedo: 'git:canRedo',
  gitRedoRollback: 'git:redoRollback',
  gitRollbackTask: 'git:rollbackTask',
  diagnosticsExport: 'diagnostics:export',
  devInfo: 'dev:info',
  overviewInfo: 'overview:info',
  fsListDir: 'fs:listDir',
  fsReadFile: 'fs:readFile',
  fsAttach: 'fs:attach',
  skillsList: 'skills:list',
  skillsImport: 'skills:import',
  skillsOpenDir: 'skills:openDir',
  mcpStatus: 'mcp:status',
  mcpAdd: 'mcp:add',
  planGet: 'plan:get',
  planUpdate: 'plan:update',
  subagentActivity: 'agent:subagentActivity',
  changesRejectHunk: 'changes:rejectHunk',
  changesAcceptHunk: 'changes:acceptHunk',
  shellOpenExternal: 'shell:openExternal',
  repoInfo: 'repo:info',
  repoSetMode: 'repo:setMode',
  previewShow: 'preview:show',
  previewSetBounds: 'preview:setBounds',
  previewNavigate: 'preview:navigate',
  previewReload: 'preview:reload',
  previewHide: 'preview:hide',
  previewDetect: 'preview:detect',
  previewCurrentUrl: 'preview:currentUrl',
  memoryList: 'memory:list',
  memoryRead: 'memory:read',
  memoryWrite: 'memory:write',
  memoryRemove: 'memory:remove',
  logsOpenDir: 'logs:openDir',
  logsReportError: 'logs:reportError',
} as const
