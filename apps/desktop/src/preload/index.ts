import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AppApi,
  type BalanceState,
  type AgentEventMsg,
  type PermissionRequest,
  type MeterUpdate,
  type TaskReceipt,
} from '../shared/ipc'
import type { Settings } from '../shared/settings'

const api: AppApi = {
  // Static OS tag so the renderer can branch chrome (macOS traffic lights vs.
  // in-app window controls) without an async round-trip or a render flash.
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    maximize: () => ipcRenderer.send(IPC.windowMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
    onMaximizeChange: (cb) => {
      const listener = (_e: unknown, maximized: boolean): void => cb(maximized)
      ipcRenderer.on(IPC.windowMaximizeChange, listener)
      return () => ipcRenderer.removeListener(IPC.windowMaximizeChange, listener)
    },
  },
  settings: {
    getAll: () => ipcRenderer.invoke(IPC.settingsGetAll),
    set: <K extends keyof Settings>(key: K, value: Settings[K]) =>
      ipcRenderer.invoke(IPC.settingsSet, key, value),
  },
  apiKey: {
    set: (key) => ipcRenderer.invoke(IPC.apiKeySet, key),
    status: () => ipcRenderer.invoke(IPC.apiKeyStatus),
    clear: () => ipcRenderer.invoke(IPC.apiKeyClear),
  },
  balance: {
    get: () => ipcRenderer.invoke(IPC.balanceGet),
    onUpdate: (cb) => {
      const listener = (_e: unknown, state: BalanceState): void => cb(state)
      ipcRenderer.on(IPC.balanceUpdate, listener)
      return () => ipcRenderer.removeListener(IPC.balanceUpdate, listener)
    },
  },
  project: {
    pick: () => ipcRenderer.invoke(IPC.projectPick),
    get: () => ipcRenderer.invoke(IPC.projectGet),
    recents: () => ipcRenderer.invoke(IPC.projectRecents),
    switch: (dir) => ipcRenderer.invoke(IPC.projectSwitch, dir),
    openInExplorer: (dir) => ipcRenderer.send(IPC.projectOpenExplorer, dir),
    removeRecent: (dir) => ipcRenderer.invoke(IPC.projectRemoveRecent, dir),
    onChange: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.projectChange, listener)
      return () => ipcRenderer.removeListener(IPC.projectChange, listener)
    },
  },
  receipt: {
    get: (target) => ipcRenderer.invoke(IPC.receiptGet, target),
  },
  session: {
    list: (dir) => ipcRenderer.invoke(IPC.sessionList, dir),
    create: (dir) => ipcRenderer.invoke(IPC.sessionCreate, dir),
    select: (id) => ipcRenderer.invoke(IPC.sessionSelect, id),
    current: () => ipcRenderer.invoke(IPC.sessionCurrent),
    rename: (id, title) => ipcRenderer.invoke(IPC.sessionRename, id, title),
    remove: (id) => ipcRenderer.invoke(IPC.sessionRemove, id),
    deselect: () => ipcRenderer.invoke(IPC.sessionDeselect),
    peek: (id) => ipcRenderer.invoke(IPC.sessionPeek, id),
    search: (query) => ipcRenderer.invoke(IPC.sessionSearch, query),
    fork: (sessionId, messageId) => ipcRenderer.invoke(IPC.sessionFork, sessionId, messageId),
    rewind: (sessionId, messageId) => ipcRenderer.invoke(IPC.sessionRewind, sessionId, messageId),
    onChange: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.sessionChange, listener)
      return () => ipcRenderer.removeListener(IPC.sessionChange, listener)
    },
  },
  usage: {
    summary: () => ipcRenderer.invoke(IPC.usageSummary),
    stats: () => ipcRenderer.invoke(IPC.usageStats),
    dashboard: (rangeDays) => ipcRenderer.invoke(IPC.usageDashboard, rangeDays),
    timeline: (sessionId) => ipcRenderer.invoke(IPC.usageTimeline, sessionId),
    projectStats: (dir) => ipcRenderer.invoke(IPC.usageProjectStats, dir),
    reset: () => ipcRenderer.invoke(IPC.usageReset),
  },
  agent: {
    send: (text) => ipcRenderer.invoke(IPC.agentSend, text),
    abort: () => ipcRenderer.send(IPC.agentAbort),
    runningState: (sessionId) => ipcRenderer.invoke(IPC.agentRunningState, sessionId),
    onEvent: (cb) => {
      const listener = (_e: unknown, msg: AgentEventMsg): void => cb(msg)
      ipcRenderer.on(IPC.agentEvent, listener)
      return () => ipcRenderer.removeListener(IPC.agentEvent, listener)
    },
    onReceipt: (cb) => {
      const listener = (_e: unknown, msg: { sessionId: string; receipt: TaskReceipt }): void =>
        cb(msg)
      ipcRenderer.on(IPC.agentReceipt, listener)
      return () => ipcRenderer.removeListener(IPC.agentReceipt, listener)
    },
    onSubagentActivity: (cb) => {
      const listener = (_e: unknown, msg: { sessionId: string; text: string }): void => cb(msg)
      ipcRenderer.on(IPC.subagentActivity, listener)
      return () => ipcRenderer.removeListener(IPC.subagentActivity, listener)
    },
  },
  changes: {
    list: () => ipcRenderer.invoke(IPC.changesList),
    diff: (path) => ipcRenderer.invoke(IPC.changesDiff, path),
    accept: (path) => ipcRenderer.invoke(IPC.changesAccept, path),
    reject: (path) => ipcRenderer.invoke(IPC.changesReject, path),
    rejectedPath: () => ipcRenderer.invoke(IPC.changesRejectedPath),
    undoReject: () => ipcRenderer.invoke(IPC.changesUndoReject),
    rejectHunk: (path, hunk) => ipcRenderer.invoke(IPC.changesRejectHunk, path, hunk),
    acceptHunk: (path, hunk) => ipcRenderer.invoke(IPC.changesAcceptHunk, path, hunk),
    onUpdate: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.changesUpdate, listener)
      return () => ipcRenderer.removeListener(IPC.changesUpdate, listener)
    },
  },
  permission: {
    onRequest: (cb) => {
      const listener = (_e: unknown, req: PermissionRequest): void => cb(req)
      ipcRenderer.on(IPC.permissionRequest, listener)
      return () => ipcRenderer.removeListener(IPC.permissionRequest, listener)
    },
    respond: (id, grant) => ipcRenderer.send(IPC.permissionRespond, id, grant),
  },
  git: {
    isRepo: () => ipcRenderer.invoke(IPC.gitIsRepo),
    init: () => ipcRenderer.invoke(IPC.gitInit),
    branch: () => ipcRenderer.invoke(IPC.gitBranch),
    rollbackTask: () => ipcRenderer.invoke(IPC.gitRollbackTask),
    canRedo: () => ipcRenderer.invoke(IPC.gitCanRedo),
    redoRollback: () => ipcRenderer.invoke(IPC.gitRedoRollback),
  },
  meter: {
    onUpdate: (cb) => {
      const listener = (_e: unknown, m: MeterUpdate): void => cb(m)
      ipcRenderer.on(IPC.meterUpdate, listener)
      return () => ipcRenderer.removeListener(IPC.meterUpdate, listener)
    },
  },
  logs: {
    openDir: () => ipcRenderer.send(IPC.logsOpenDir),
    reportError: (message, meta) => ipcRenderer.send(IPC.logsReportError, message, meta),
  },
  diagnostics: {
    export: () => ipcRenderer.invoke(IPC.diagnosticsExport),
  },
  dev: {
    info: () => ipcRenderer.invoke(IPC.devInfo),
  },
  overview: {
    info: () => ipcRenderer.invoke(IPC.overviewInfo),
  },
  fs: {
    listDir: (rel) => ipcRenderer.invoke(IPC.fsListDir, rel),
    readFile: (rel) => ipcRenderer.invoke(IPC.fsReadFile, rel),
    attach: () => ipcRenderer.invoke(IPC.fsAttach),
  },
  skills: {
    list: () => ipcRenderer.invoke(IPC.skillsList),
    import: () => ipcRenderer.invoke(IPC.skillsImport),
    openDir: () => ipcRenderer.send(IPC.skillsOpenDir),
  },
  mcp: {
    status: () => ipcRenderer.invoke(IPC.mcpStatus),
    add: (name, command, args) => ipcRenderer.invoke(IPC.mcpAdd, name, command, args),
  },
  plan: {
    get: () => ipcRenderer.invoke(IPC.planGet),
    onUpdate: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.planUpdate, listener)
      return () => ipcRenderer.removeListener(IPC.planUpdate, listener)
    },
  },
  shell: {
    openExternal: (url) => ipcRenderer.send(IPC.shellOpenExternal, url),
  },
  repo: {
    info: () => ipcRenderer.invoke(IPC.repoInfo),
    setMode: (on) => ipcRenderer.invoke(IPC.repoSetMode, on),
  },
  preview: {
    show: (bounds, url) => ipcRenderer.send(IPC.previewShow, bounds, url),
    setBounds: (bounds) => ipcRenderer.send(IPC.previewSetBounds, bounds),
    navigate: (url) => ipcRenderer.send(IPC.previewNavigate, url),
    reload: () => ipcRenderer.send(IPC.previewReload),
    hide: () => ipcRenderer.send(IPC.previewHide),
    detect: () => ipcRenderer.invoke(IPC.previewDetect),
    currentUrl: () => ipcRenderer.invoke(IPC.previewCurrentUrl),
  },
  memory: {
    list: (scope) => ipcRenderer.invoke(IPC.memoryList, scope),
    read: (name, scope) => ipcRenderer.invoke(IPC.memoryRead, name, scope),
    write: (name, content, scope) => ipcRenderer.invoke(IPC.memoryWrite, name, content, scope),
    remove: (name, scope) => ipcRenderer.invoke(IPC.memoryRemove, name, scope),
  },
}

contextBridge.exposeInMainWorld('api', api)
