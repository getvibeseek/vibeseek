/** Persisted application settings. Lives in userData/settings.json. */
export interface Settings {
  schemaVersion: number
  locale: string
  /** 'system' follows the OS preference live. */
  theme: 'dark' | 'light' | 'system'
  baseUrl: string
  zoomFactor: number
  window: WindowState
  /** Last opened project directory (agent working dir), or null. */
  projectDir: string | null
  /** Recently opened project directories, most-recent first. */
  recentProjects: string[]
  /** Display-name aliases keyed by project dir; missing = folder basename. */
  projectAliases: Record<string, string>
  /** Concrete model id, or 'auto' = triage routing. */
  model: string
  thinking: 'off' | 'high' | 'max' | 'auto'
  /** Per-project model/thinking memory; falls back to the globals above. */
  projectModels: Record<string, { model: string; thinking: 'off' | 'high' | 'max' | 'auto' }>
  /** Per-project 全库模式 toggle: whole repo into the semi-stable layer. */
  repoMode: Record<string, boolean>
  /** Per-task cost cap in ¥; null = unlimited. Near the cap → flash+off. */
  taskBudget: number | null
  /** Low-balance notification threshold in ¥; null = off. */
  balanceAlertYuan: number | null
  /** Daily spend notification threshold in ¥; null = off. */
  dayCostAlertYuan: number | null
  /**
   * Access level (Codex-style): 'standard' = confirm writes, 'yolo' = full
   * access (dangerous commands still confirm). Plan is NOT a level — it's the
   * planMode collaboration toggle below (方案 协作方式).
   */
  permissionMode: 'standard' | 'yolo'
  /** Collaboration mode: read-only planning pass before touching anything. */
  planMode: boolean
  /** Per-project tool allowlist: { [projectDir]: toolName[] }. */
  allowlist: Record<string, string[]>
  /** Per-project DISABLED skill names (default = all enabled); new conversations only. */
  skillsDisabled: Record<string, string[]>
  /** Per-project DISABLED MCP server names (tools filtered out); new conversations only. */
  mcpDisabled: Record<string, string[]>
  /** Inject memory (project + global) into new conversations. Default on. */
  memoryEnabled: boolean
  /** First-run onboarding completed (theme + key + feature intro). */
  onboarded: boolean
}

export interface WindowState {
  width: number
  height: number
  x: number | null
  y: number | null
  maximized: boolean
}

export const CURRENT_SCHEMA_VERSION = 3

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  locale: 'zh-CN',
  theme: 'system',
  baseUrl: 'https://api.deepseek.com',
  zoomFactor: 1,
  window: {
    width: 1280,
    height: 800,
    x: null,
    y: null,
    maximized: false,
  },
  projectDir: null,
  recentProjects: [],
  projectAliases: {},
  model: 'deepseek-v4-flash',
  thinking: 'high',
  projectModels: {},
  repoMode: {},
  taskBudget: null,
  balanceAlertYuan: 10,
  dayCostAlertYuan: null,
  permissionMode: 'standard',
  planMode: false,
  allowlist: {},
  skillsDisabled: {},
  mcpDisabled: {},
  memoryEnabled: true,
  onboarded: false,
}
