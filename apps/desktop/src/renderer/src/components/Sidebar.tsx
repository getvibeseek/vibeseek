import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PenLine, Search, LayoutGrid } from 'lucide-react'
import type { Workspace } from '../hooks/useWorkspace'
import { UsagePopover } from './UsagePopover'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { useConfirm } from './Confirm'
import type { ReceiptTarget } from './ReceiptPopover'

interface SidebarProps {
  onOpenSettings: () => void
  onNewTask: () => void
  /** Project row clicked → project home (its own stats + composer). */
  onOpenProject: () => void
  /** "+" on a project → clean draft chat in that project (lazy-create on send). */
  onNewInProject: () => void
  onOpenDashboard: () => void
  onOpenSearch: () => void
  dashboardActive: boolean
  /** 新任务/仪表盘 are not "inside a project" — suppress the project highlight. */
  suppressProjectActive: boolean
  onShowReceipt: (target: ReceiptTarget) => void
  ws: Workspace
}

function relTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

interface SessionRowProps {
  title: string
  time: string
  active: boolean
  editing: boolean
  onSelect: () => void
  onStartEdit: () => void
  onCommitEdit: (title: string) => void
  onCancelEdit: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

/** A conversation row: click opens, double-click renames, right-click for menu. */
function SessionRow({
  title,
  time,
  active,
  editing,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onContextMenu,
}: SessionRowProps): JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setDraft(title)
      // Select after the input mounts.
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [editing, title])

  if (editing) {
    return (
      <div className="sidebar-item session-row editing">
        <input
          ref={inputRef}
          className="session-rename-input mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onCommitEdit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitEdit(draft)
            if (e.key === 'Escape') onCancelEdit()
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={active ? 'sidebar-item session-row active' : 'sidebar-item session-row'}
      onClick={onSelect}
      onDoubleClick={onStartEdit}
      onContextMenu={onContextMenu}
    >
      <span className="sidebar-item-label">{title || t('sidebar.untitled')}</span>
      <span className="sidebar-item-meta session-time">{time}</span>
    </div>
  )
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

/**
 * Data-driven sidebar (修订): collapsible project groups with nested
 * sessions, right-click menus on both (Codex/Claude-Code style), bottom row =
 * usage popover + settings entry.
 */
export function Sidebar({
  onOpenSettings,
  onNewTask,
  onOpenProject,
  onNewInProject,
  onOpenDashboard,
  onOpenSearch,
  dashboardActive,
  suppressProjectActive,
  onShowReceipt,
  ws,
}: SidebarProps): JSX.Element {
  // Switch (or just deselect when already current) so the target project's
  // composer is a fresh draft — no DB session is created until first send.
  const focusProject = (dir: string): void => {
    if (ws.project !== dir) ws.switchProject(dir)
    else ws.deselect()
  }
  const { t } = useTranslation()
  const confirm = useConfirm()
  // Expand/collapse state survives restarts — the sidebar reopens exactly the
  // way it was closed (user feedback).
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem('sidebar.expanded') ?? '[]'))
    } catch {
      return new Set<string>()
    }
  })
  useEffect(() => {
    localStorage.setItem('sidebar.expanded', JSON.stringify([...expanded]))
  }, [expanded])
  const [usageOpen, setUsageOpen] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingProject, setEditingProject] = useState<string | null>(null)
  const [projectDraft, setProjectDraft] = useState('')
  const projectInputRef = useRef<HTMLInputElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editingProject) setTimeout(() => projectInputRef.current?.select(), 0)
  }, [editingProject])

  useEffect(() => {
    if (ws.project) setExpanded((prev) => new Set(prev).add(ws.project!))
  }, [ws.project])

  useEffect(() => {
    if (!usageOpen) return
    const onDown = (e: MouseEvent): void => {
      if (footerRef.current && !footerRef.current.contains(e.target as Node)) setUsageOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [usageOpen])

  const toggle = (dir: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  }

  // Whole conversation → clipboard as markdown (tool noise excluded).
  const copyConversation = async (id: string, title: string): Promise<void> => {
    const msgs = await window.api.session.peek(id)
    const lines = msgs
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.text))
      .map(
        (m) =>
          `**${m.role === 'user' ? '我' : 'VibeSeek'}**（${m.ts?.slice(0, 16).replace('T', ' ') ?? ''}）：\n\n${m.text}`
      )
    await navigator.clipboard.writeText(
      `# ${title || t('sidebar.untitled')}\n\n${lines.join('\n\n---\n\n')}`
    )
  }

  const sessionMenu = (e: React.MouseEvent, id: string, title: string): void => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: t('menu.viewReceipt'),
          onClick: () =>
            onShowReceipt({ scope: 'session', id, label: title || t('sidebar.untitled') }),
        },
        { label: t('sidebar.rename'), onClick: () => setEditingId(id) },
        { label: t('menu.copyConversation'), onClick: () => void copyConversation(id, title) },
        { label: t('menu.copySessionId'), onClick: () => void navigator.clipboard.writeText(id) },
        { separator: true, label: '' },
        {
          label: t('sidebar.delete'),
          danger: true,
          onClick: () => {
            void confirm({
              title: t('sidebar.delete'),
              message: t('sidebar.deleteConfirm'),
              confirmLabel: t('sidebar.delete'),
              danger: true,
            }).then((ok) => {
              if (ok) ws.removeSession(id)
            })
          },
        },
      ],
    })
  }

  const projectMenu = (e: React.MouseEvent, dir: string): void => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: t('sidebar.newInProject'),
          onClick: () => {
            focusProject(dir)
            setExpanded((prev) => new Set(prev).add(dir))
            onNewInProject()
          },
        },
        {
          label: t('menu.viewReceipt'),
          onClick: () => onShowReceipt({ scope: 'project', id: dir, label: ws.nameOf(dir) }),
        },
        {
          label: t('menu.renameProject'),
          onClick: () => {
            setProjectDraft(ws.nameOf(dir))
            setEditingProject(dir)
          },
        },
        { separator: true, label: '' },
        { label: t('menu.openExplorer'), onClick: () => window.api.project.openInExplorer(dir) },
        { label: t('menu.copyPath'), onClick: () => void navigator.clipboard.writeText(dir) },
        { separator: true, label: '' },
        {
          label: t('menu.removeRecent'),
          danger: true,
          onClick: () => void window.api.project.removeRecent(dir),
        },
      ],
    })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-quick">
        <button className="sidebar-item" onClick={() => onNewTask()}>
          <PenLine className="sidebar-icon" size={15} /> {t('nav.newTask')}
        </button>
        <button className="sidebar-item" onClick={onOpenSearch}>
          <Search className="sidebar-icon" size={15} /> {t('nav.search')}
        </button>
        <button
          className={dashboardActive ? 'sidebar-item active' : 'sidebar-item'}
          onClick={onOpenDashboard}
        >
          <LayoutGrid className="sidebar-icon" size={15} /> {t('nav.dashboard')}
        </button>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-group-label">
          {t('sidebar.projects')}
          <button className="sidebar-add" title={t('sidebar.addProject')} onClick={ws.pickProject}>
            +
          </button>
        </div>
        {ws.recents.length === 0 && (
          <div className="sidebar-empty prose dim">{t('sidebar.noProjects')}</div>
        )}
        {ws.recents.map((dir) => {
          const isOpen = expanded.has(dir)
          const isActive = !suppressProjectActive && ws.project === dir
          const sessions = ws.sessionsByProject[dir] ?? []
          return (
            <div key={dir} className="sidebar-project">
              <div
                className={
                  isActive ? 'sidebar-item project-row active' : 'sidebar-item project-row'
                }
                onContextMenu={(e) => projectMenu(e, dir)}
              >
                <button className="project-chevron" aria-label="toggle" onClick={() => toggle(dir)}>
                  <span className={isOpen ? 'chevron open' : 'chevron'}>▸</span>
                </button>
                {editingProject === dir ? (
                  <input
                    ref={projectInputRef}
                    className="session-rename-input mono"
                    value={projectDraft}
                    onChange={(e) => setProjectDraft(e.target.value)}
                    onBlur={() => {
                      ws.renameProject(dir, projectDraft)
                      setEditingProject(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        ws.renameProject(dir, projectDraft)
                        setEditingProject(null)
                      }
                      if (e.key === 'Escape') setEditingProject(null)
                    }}
                  />
                ) : (
                  <button
                    className="project-name"
                    title={dir}
                    onClick={() => {
                      focusProject(dir)
                      setExpanded((prev) => new Set(prev).add(dir))
                      onOpenProject()
                    }}
                  >
                    {ws.nameOf(dir)}
                  </button>
                )}
                <button
                  className="project-new"
                  title={t('sidebar.newInProject')}
                  onClick={() => {
                    focusProject(dir)
                    setExpanded((prev) => new Set(prev).add(dir))
                    onNewInProject()
                  }}
                >
                  +
                </button>
                <span className="sidebar-item-meta">{sessions.length || ''}</span>
              </div>
              <div className={isOpen ? 'project-sessions open' : 'project-sessions'}>
                <div className="project-sessions-inner">
                  {sessions.length === 0 && (
                    <div className="sidebar-empty nested prose dim">{t('sidebar.noSessions')}</div>
                  )}
                  {sessions.map((s) => (
                    <SessionRow
                      key={s.id}
                      title={s.title}
                      time={relTime(s.updatedAt)}
                      active={ws.currentId === s.id}
                      editing={editingId === s.id}
                      onSelect={() => ws.selectSession(s.id)}
                      onStartEdit={() => setEditingId(s.id)}
                      onCommitEdit={(title) => {
                        setEditingId(null)
                        const next = title.trim()
                        if (next && next !== s.title) ws.renameSession(s.id, next)
                      }}
                      onCancelEdit={() => setEditingId(null)}
                      onContextMenu={(e) => sessionMenu(e, s.id, s.title)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="sidebar-footer" ref={footerRef}>
        <button className="sidebar-usage" onClick={() => setUsageOpen((v) => !v)}>
          <span className="sidebar-icon">◔</span>
          <span className="sidebar-account-name">{t('usage.title')}</span>
          <span className="sidebar-item-meta">{usageOpen ? '▾' : '▴'}</span>
        </button>
        <button
          className="sidebar-usage sidebar-settings-btn"
          title={t('sidebar.settings')}
          onClick={onOpenSettings}
        >
          <span className="sidebar-icon">⚙</span>
        </button>
        {usageOpen && <UsagePopover onClose={() => setUsageOpen(false)} />}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
    </aside>
  )
}
