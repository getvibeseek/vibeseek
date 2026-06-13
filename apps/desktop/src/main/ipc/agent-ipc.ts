import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import {
  IPC,
  type FileChange,
  type FileDiff,
  type PermitGrant,
  type ReceiptScope,
  type MemoryScope,
} from '../../shared/ipc'
import type { AgentService } from '../agent/agent-service'
import type { SettingsStore } from '../store/settings-store'

export function registerAgentIpc(agent: AgentService, settings: SettingsStore): void {
  ipcMain.handle(IPC.projectGet, () => settings.get('projectDir'))
  ipcMain.handle(IPC.projectRecents, () => agent.recentProjects())
  ipcMain.handle(IPC.projectSwitch, (_e, dir: string) => agent.setProject(String(dir)))
  ipcMain.handle(IPC.projectPick, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    // Cancel returns null — callers must not mistake it for a pick (the home
    // composer treats the result as the user's explicit folder choice).
    if (res.canceled || res.filePaths.length === 0) return null
    agent.setProject(res.filePaths[0])
    return res.filePaths[0]
  })

  ipcMain.on(IPC.projectOpenExplorer, (_e, dir: string) => void shell.openPath(String(dir)))
  ipcMain.handle(IPC.projectRemoveRecent, (_e, dir: string) =>
    agent.removeRecentProject(String(dir))
  )
  ipcMain.handle(IPC.receiptGet, (_e, target: ReceiptScope) => agent.receiptFor(target))

  ipcMain.handle(IPC.sessionList, (_e, dir?: string) =>
    agent.listSessions(dir ? String(dir) : undefined)
  )
  ipcMain.handle(IPC.sessionCreate, (_e, dir?: string) =>
    agent.newSession(dir ? String(dir) : undefined)
  )
  ipcMain.handle(IPC.sessionSelect, (_e, id: string) => agent.selectSession(String(id)))
  ipcMain.handle(IPC.sessionCurrent, () => agent.currentSession())
  ipcMain.handle(IPC.sessionRename, (_e, id: string, title: string) =>
    agent.renameSession(String(id), String(title))
  )
  ipcMain.handle(IPC.sessionRemove, (_e, id: string) => agent.removeSession(String(id)))
  ipcMain.handle(IPC.sessionDeselect, () => agent.deselect())
  ipcMain.handle(IPC.sessionPeek, (_e, id: string) => agent.peekSession(String(id)))
  ipcMain.handle(IPC.sessionSearch, (_e, query: string) => agent.searchSessions(String(query)))
  ipcMain.handle(IPC.sessionFork, (_e, id: string, messageId: number) =>
    agent.forkSession(String(id), Number(messageId))
  )
  ipcMain.handle(IPC.sessionRewind, (_e, id: string, messageId: number) =>
    agent.rewindSession(String(id), Number(messageId))
  )
  ipcMain.handle(IPC.usageSummary, () => agent.usageSummary())
  ipcMain.handle(IPC.usageStats, () => agent.dashboardStats())
  ipcMain.handle(IPC.usageDashboard, (_e, rangeDays: number | null) =>
    agent.dashboard(typeof rangeDays === 'number' ? rangeDays : null)
  )
  ipcMain.handle(IPC.usageTimeline, (_e, sessionId: string) => agent.timeline(String(sessionId)))
  ipcMain.handle(IPC.usageProjectStats, (_e, dir: string) => agent.projectStats(String(dir)))
  ipcMain.handle(IPC.usageReset, () => agent.resetUsage())

  ipcMain.handle(IPC.agentSend, (_e, text: string) => agent.run(String(text)))
  ipcMain.on(IPC.agentAbort, () => agent.abort())
  ipcMain.handle(IPC.agentRunningState, (_e, sessionId: string) =>
    agent.runningState(String(sessionId))
  )
  ipcMain.on(IPC.permissionRespond, (_e, id: string, grant: PermitGrant) =>
    agent.resolvePermission(id, grant)
  )

  ipcMain.handle(IPC.changesList, (): FileChange[] => agent.getTracker()?.list() ?? [])
  ipcMain.handle(IPC.changesDiff, (_e, path: string): FileDiff => {
    const t = agent.getTracker()
    return t ? t.diff(path) : { path, rows: [] }
  })
  ipcMain.handle(IPC.changesAccept, (_e, path: string) => agent.getTracker()?.accept(path))
  ipcMain.handle(IPC.changesReject, (_e, path: string) => agent.getTracker()?.reject(path))
  ipcMain.handle(IPC.changesRejectedPath, () => agent.getTracker()?.rejectedPath() ?? null)
  ipcMain.handle(IPC.changesUndoReject, () => agent.getTracker()?.undoReject())
  ipcMain.handle(IPC.changesRejectHunk, (_e, path: string, hunk: number) =>
    agent.getTracker()?.rejectHunk(String(path), Number(hunk))
  )
  ipcMain.handle(IPC.changesAcceptHunk, (_e, path: string, hunk: number) =>
    agent.getTracker()?.acceptHunk(String(path), Number(hunk))
  )

  ipcMain.handle(IPC.devInfo, () => agent.devInfo())
  ipcMain.handle(IPC.overviewInfo, () => agent.overviewInfo())
  ipcMain.handle(IPC.fsListDir, (_e, rel: string) => agent.listDir(String(rel ?? '')))
  ipcMain.handle(IPC.fsReadFile, (_e, rel: string) => agent.readProjectFile(String(rel)))
  ipcMain.handle(IPC.fsAttach, () => agent.attachFile())
  ipcMain.handle(IPC.skillsList, () => agent.listSkills())
  ipcMain.handle(IPC.skillsImport, () => agent.importSkill())
  ipcMain.on(IPC.skillsOpenDir, () => agent.openSkillsDir())
  ipcMain.handle(IPC.mcpStatus, () => agent.mcpStatus())
  ipcMain.handle(IPC.mcpAdd, (_e, name: string, command: string, args: string) =>
    agent.addMcpServer(String(name), String(command), String(args ?? ''))
  )
  ipcMain.handle(IPC.planGet, () => agent.planFor())
  ipcMain.handle(IPC.repoInfo, () => agent.repoModeInfo())
  ipcMain.handle(IPC.repoSetMode, (_e, on: boolean) => agent.setRepoMode(Boolean(on)))
  ipcMain.on(IPC.shellOpenExternal, (_e, url: string) => {
    // Only real web links leave the app — anything else is silently dropped.
    if (/^https?:\/\//i.test(String(url))) void shell.openExternal(String(url))
  })
  ipcMain.handle(IPC.memoryList, (_e, scope: MemoryScope = 'project') => agent.memoryList(scope))
  ipcMain.handle(IPC.memoryRead, (_e, name: string, scope: MemoryScope = 'project') =>
    agent.memoryRead(String(name), scope)
  )
  ipcMain.handle(
    IPC.memoryWrite,
    (_e, name: string, content: string, scope: MemoryScope = 'project') =>
      agent.memoryWrite(String(name), String(content), scope)
  )
  ipcMain.handle(IPC.memoryRemove, (_e, name: string, scope: MemoryScope = 'project') =>
    agent.memoryRemove(String(name), scope)
  )
  ipcMain.handle(IPC.gitIsRepo, () => agent.isRepo())
  ipcMain.handle(IPC.gitInit, () => agent.initRepo())
  ipcMain.handle(IPC.gitBranch, () => agent.gitBranch())
  ipcMain.handle(IPC.gitRollbackTask, () => agent.rollbackTask())
  ipcMain.handle(IPC.gitCanRedo, () => agent.canRedoRollback())
  ipcMain.handle(IPC.gitRedoRollback, () => agent.redoRollback())
}
