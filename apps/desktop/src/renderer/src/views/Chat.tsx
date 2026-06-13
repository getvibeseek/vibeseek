import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgent, type TranscriptItem, type ToolEntry } from '../hooks/useAgent'
import type { Workspace } from '../hooks/useWorkspace'
import { AccessMenu } from '../components/AccessMenu'
import { Achievements } from '../components/Achievements'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { Heatmap } from '../components/Heatmap'
import { ModelPicker, type Thinking } from '../components/ModelPicker'
import { Markdown } from '../components/Markdown'
import { useConfirm } from '../components/Confirm'
import { yuan } from '../money'
import type { ReceiptTarget } from '../components/ReceiptPopover'
import type { Settings } from '../../../shared/settings'
import {
  Folder,
  GitBranch,
  BookMarked,
  Plus,
  Paperclip,
  Image as ImageIcon,
  Puzzle,
} from 'lucide-react'
import { DotField } from '../components/fx/DotField'
import { spotlightMove } from '../components/fx/spotlight'
import { useThemeAttr } from '../hooks/useThemeAttr'
import type { ProjectStats, SkillInfo, McpStatus } from '../../../shared/ipc'

/**
 * Stable rolling tail for streaming text (v2 after user feedback: the naive
 * tail jittered and "shouted"). Fixed-height box, bottom-anchored, refreshed at
 * most every 200ms, always whole lines — the only motion is a quiet line feed.
 */
function StreamTail({ text }: { text: string }): JSX.Element {
  const latestRef = useRef(text)
  latestRef.current = text
  const [shown, setShown] = useState('')
  useEffect(() => {
    const timer = setInterval(() => {
      const lines = latestRef.current.trimEnd().split('\n')
      setShown(lines.slice(-3).join('\n'))
    }, 200)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="stream-tail">
      <div className="stream-tail-inner mono">{shown}</div>
    </div>
  )
}

function ToolCard({ tool }: { tool: ToolEntry }): JSX.Element {
  const [open, setOpen] = useState(false)
  const pending = !tool.result
  const failed = tool.result?.isError
  const arg = tool.input.path ?? tool.input.command ?? tool.input.pattern ?? ''
  return (
    <div className={`tool-card ${failed ? 'tool-failed' : ''} ${pending ? 'tool-pending' : ''}`}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        <span className="tool-dot">{pending ? '◌' : failed ? '✗' : '✓'}</span>
        <span className="mono tool-name">{tool.name}</span>
        <span className="mono tool-arg">{String(arg)}</span>
      </button>
      {open && tool.result && <pre className="tool-out mono">{tool.result.content}</pre>}
    </div>
  )
}

/**
 * Tool calls render as ONE quiet group: long runs used to stack a wall
 * of bordered cards. Past a few steps the finished ones fold behind a
 * "执行了 N 步" header; the in-flight call always stays visible.
 */
function ToolGroup({ tools, done }: { tools: ToolEntry[]; done: boolean }): JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (tools.length === 0) return null
  const failed = tools.filter((tl) => tl.result?.isError).length
  const collapsible = tools.length >= 4
  const visible = collapsible && !open ? tools.filter((tl) => !tl.result) : tools
  return (
    <div className="tool-group">
      {collapsible && (
        <button className="tool-group-head" onClick={() => setOpen(!open)}>
          <span className={open ? 'chevron open' : 'chevron'}>▸</span>
          {t('chat.steps', { n: tools.length })}
          {failed > 0 && <span className="tool-group-failed">{failed} ✗</span>}
          {!done && !open && <span className="dim"> …</span>}
        </button>
      )}
      {visible.map((tl) => (
        <ToolCard key={tl.id} tool={tl} />
      ))}
    </div>
  )
}

/** Relative "x分钟前" for the message toolbar; absolute time in the title. */
function agoLabel(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000)
  if (Number.isNaN(mins)) return ''
  if (mins < 1) return t('msg.justNow')
  if (mins < 60) return t('msg.minsAgo', { n: mins })
  if (mins < 24 * 60) return t('msg.hoursAgo', { n: Math.floor(mins / 60) })
  return new Date(iso).toLocaleString()
}

const CopyIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)
const CheckIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
const ForkIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="12" cy="20" r="2.5" />
    <path d="M6 8.5v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-2" />
    <path d="M12 13.5v4" />
  </svg>
)
const RewindIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 8h10a5 5 0 0 1 0 10H8" />
    <polyline points="6 5 3 8 6 11" />
  </svg>
)

/**
 * Hover toolbar on a message bubble (Claude-Code style): a quiet row of
 * line-icon buttons with CSS tooltips (data-tip — i18n-ready, no native title)
 * plus the submit time. Reveals on bubble hover. Fork on any message; rewind
 * only on user turns (redo from here, restoring files).
 */
function MsgToolbar({
  text,
  ts,
  id,
  onFork,
  onRewind,
}: {
  text: string
  ts?: string
  id?: number
  onFork?: (id: number) => void
  onRewind?: (id: number, text: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <div className="msg-toolbar">
      <button
        className={copied ? 'icon-btn tip is-ok' : 'icon-btn tip'}
        data-tip={copied ? t('msg.copied') : t('msg.copy')}
        aria-label={t('msg.copy')}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
        }}
      >
        {copied ? CheckIcon : CopyIcon}
      </button>
      {id !== undefined && onRewind && (
        <button
          className="icon-btn tip"
          data-tip={t('msg.rewind')}
          aria-label={t('msg.rewind')}
          onClick={() => onRewind(id, text)}
        >
          {RewindIcon}
        </button>
      )}
      {id !== undefined && onFork && (
        <button
          className="icon-btn tip"
          data-tip={t('msg.fork')}
          aria-label={t('msg.fork')}
          onClick={() => onFork(id)}
        >
          {ForkIcon}
        </button>
      )}
      {ts && (
        <span className="msg-time tip" data-tip={new Date(ts).toLocaleString()}>
          {agoLabel(ts, t)}
        </span>
      )}
    </div>
  )
}

/**
 * CC-style live run indicator, pinned at the BOTTOM of the transcript for the
 * whole task (user feedback ×2: long tool runs and cold prefills showed no
 * sign of life anywhere). Spinning asterisk + elapsed seconds + Esc hint.
 */
function RunningLine({
  startedAt,
  model,
  subagent,
}: {
  startedAt: number | null
  model: string | null
  /** What the dispatched sub-agent is doing right now ('' = none). */
  subagent: string
}): JSX.Element {
  const { t } = useTranslation()
  // Elapsed is anchored to the real start time (from main), so it survives
  // window switches instead of restarting from 0 (user report).
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  const secs = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0
  return (
    <div className="running-line">
      <span className="running-star">✳</span>
      <span>{t('chat.running')}</span>
      {model && <span className="mono dim">{model.replace('deepseek-', '')}</span>}
      {secs >= 2 && <span className="tnum dim">{secs}s</span>}
      {subagent && (
        <span className="mono dim subagent-line">
          {t('chat.subagent')} {subagent}
        </span>
      )}
      <span className="dim">{t('chat.runningEsc')}</span>
      {secs >= 20 && <span className="waiting-hint dim">{t('chat.waitingLong')}</span>}
    </div>
  )
}

function AssistantItem({
  item,
  canExecutePlan,
  onExecutePlan,
  onFork,
}: {
  item: Extract<TranscriptItem, { kind: 'assistant' }>
  canExecutePlan: boolean
  onExecutePlan: () => void
  onFork?: (id: number) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [showThinking, setShowThinking] = useState(false)
  return (
    <div className="msg assistant">
      {item.reasoning && (
        <div className="thinking">
          <button className="thinking-head" onClick={() => setShowThinking(!showThinking)}>
            {t('chat.thinking')} {showThinking ? '▾' : '▸'}
          </button>
          {showThinking && <div className="thinking-body">{item.reasoning}</div>}
        </div>
      )}
      <ToolGroup tools={item.tools} done={item.done} />
      {item.text &&
        (item.done ? (
          <div className="msg-body md-final">
            <Markdown text={item.text} />
          </div>
        ) : (
          // While streaming, show only a quiet rolling TAIL (CC-style): pages
          // of narration/code yanking the scrollbar around is exhausting and
          // unreadable (user feedback). The full reply lands once, on done.
          <StreamTail text={item.text} />
        ))}
      {canExecutePlan && (
        <div className="plan-handoff">
          <button className="btn plan-exec" onClick={onExecutePlan}>
            {t('plan.execute')}
          </button>
          <span className="plan-handoff-hint">{t('plan.executeHint')}</span>
        </div>
      )}
      {item.done && item.text && (
        <MsgToolbar text={item.text} ts={item.ts} id={item.id} onFork={onFork} />
      )}
    </div>
  )
}

/** Project home: this project's own consumption, shown when its row is clicked. */
function ProjectStatsPanel({
  dir,
  name,
}: {
  dir: string | null
  name: string
}): JSX.Element | null {
  const { t } = useTranslation()
  const [stats, setStats] = useState<ProjectStats | null>(null)
  useEffect(() => {
    if (dir) void window.api.usage.projectStats(dir).then(setStats)
  }, [dir])
  if (!dir) return null
  const compactN = (n: number): string =>
    n < 1000
      ? String(n)
      : n < 1_000_000
        ? (n / 1000).toFixed(1) + 'k'
        : (n / 1_000_000).toFixed(1) + 'M'
  return (
    <div className="proj-home">
      <h2 className="proj-home-title">{name}</h2>
      <p className="proj-home-sub">{t('proj.sub')}</p>
      {stats && (
        <>
          <div className="dash-grid">
            <div className="dash-stat spotlight" onMouseMove={spotlightMove}>
              <div className="dash-stat-value tnum">{compactN(stats.sessions)}</div>
              <div className="ach-card-label">{t('dash.sessions')}</div>
            </div>
            <div className="dash-stat spotlight" onMouseMove={spotlightMove}>
              <div className="dash-stat-value tnum">{compactN(stats.messages)}</div>
              <div className="ach-card-label">{t('dash.messages')}</div>
            </div>
            <div className="dash-stat spotlight" onMouseMove={spotlightMove}>
              <div className="dash-stat-value tnum">{compactN(stats.tokens)}</div>
              <div className="ach-card-label">{t('dash.tokens')}</div>
            </div>
            <div className="dash-stat spotlight" onMouseMove={spotlightMove}>
              <div className="dash-stat-value tnum">{yuan(stats.cost, 2)}</div>
              <div className="ach-card-label">{t('dash.cost')}</div>
            </div>
            <div className="dash-stat spotlight" onMouseMove={spotlightMove}>
              <div className="dash-stat-value tnum dash-accent">{yuan(stats.saved, 2)}</div>
              <div className="ach-card-label">{t('dash.saved')}</div>
            </div>
            <div className="dash-stat spotlight" onMouseMove={spotlightMove}>
              <div className="dash-stat-value tnum dash-accent">
                {Math.round(stats.hitRate * 100)}%
              </div>
              <div className="ach-card-label">{t('dash.hitRate')}</div>
            </div>
          </div>
          {stats.models.length > 0 && (
            <div className="dash-models">
              {stats.models.map((m) => (
                <div key={m.model} className="dash-model-row">
                  <span className="dash-model-name">{m.model.replace('deepseek-', '')}</span>
                  <span className="dash-model-meta mono">
                    {compactN(m.hitTokens + m.missTokens)} {t('dash.in')} ·{' '}
                    {compactN(m.outputTokens)} {t('dash.out')} · {m.requests} req
                  </span>
                  <span className="dash-model-cost mono">{yuan(m.cost)}</span>
                </div>
              ))}
            </div>
          )}
          {stats.heatmap.length > 0 && <Heatmap data={stats.heatmap} />}
        </>
      )}
      <p className="proj-home-hint prose dim">{t('proj.hint')}</p>
    </div>
  )
}

export type ChatMode = 'home' | 'project' | 'plain'

export function Chat({
  ws,
  mode = 'plain',
  onStarted,
  statsOpen = false,
  onToggleStats,
  onShowReceipt,
}: {
  ws: Workspace
  /** What to show while the transcript is empty: 全局成就 / 项目统计 / 提示. */
  mode?: ChatMode
  /** Fired right after the first send — the host flips to the chat view. */
  onStarted?: () => void
  /** Home page's「详细统计」expansion state (lives in App so the sidebar can drive it). */
  statsOpen?: boolean
  onToggleStats?: () => void
  onShowReceipt?: (target: ReceiptTarget) => void
}): JSX.Element {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const { items, running, runModel, runStartedAt, send, abort } = useAgent(ws.loaded, ws.currentId)
  const [input, setInput] = useState('')
  const [settings, setSettings] = useState<Settings | null>(null)
  const theme = useThemeAttr()
  const [isRepo, setIsRepo] = useState(true)
  const [branch, setBranch] = useState<string | null>(null)
  const [projMenu, setProjMenu] = useState<{ x: number; y: number } | null>(null)
  // Codex-style jump-to-bottom affordance: shown once scrolled away from the end.
  const [atBottom, setAtBottom] = useState(true)
  // 全库模式 toggle state for the active project.
  const [repoOn, setRepoOn] = useState(false)
  // Composer slash menu: directives + /skill:<name> for enabled skills.
  const [skillList, setSkillList] = useState<SkillInfo[]>([])
  const [slashSel, setSlashSel] = useState(0)
  // Composer "+" tool menu: attach a file, pin a skill, see MCP status.
  const [toolMenuOpen, setToolMenuOpen] = useState(false)
  const [mcpServers, setMcpServers] = useState<McpStatus[]>([])
  const toolMenuRef = useRef<HTMLDivElement>(null)
  // Live sub-agent activity for the running line (ephemeral).
  const [subagent, setSubagent] = useState('')
  // 新任务 = 新开项目 (user-defined semantics): the home composer starts with
  // NO folder — never auto-carries the last project, never forces a dialog.
  // The user picks via the 📁 chip; an existing-project folder gets a notice,
  // a fresh folder silently becomes a new project (recents add it).
  const [homeDir, setHomeDir] = useState<string | null>(null)
  const [homeNotice, setHomeNotice] = useState<string | null>(null)
  useEffect(() => {
    if (mode === 'home') {
      setHomeDir(null)
      setHomeNotice(null)
    }
  }, [mode])
  useEffect(() => {
    if (!homeNotice) return
    const timer = setTimeout(() => setHomeNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [homeNotice])
  const baseName = (dir: string): string => dir.split(/[\\/]/).filter(Boolean).pop() ?? dir
  const chooseHomeDir = (dir: string, existing: boolean): void => {
    setHomeDir(dir)
    setHomeNotice(
      existing
        ? t('home.existing', { name: ws.nameOf(dir) || baseName(dir) })
        : t('home.created', { name: baseName(dir) })
    )
  }
  // On home the chips/toggles describe the PICKED folder, not the last project.
  const projectChosen = mode !== 'home' || homeDir !== null
  // Whether the CURRENT conversation has the whole repo baked in (badge).
  const [repoSessionActive, setRepoSessionActive] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  // Stick-to-bottom: only follow the stream if the user is already at the bottom.
  const stickRef = useRef(true)
  // Set when a conversation (re)loads — forces ONE scroll-to-bottom regardless of
  // the previous session's scroll position (fixes inconsistent landing on switch).
  const justLoadedRef = useRef(true)
  const project = ws.project

  useEffect(() => {
    window.api.settings.getAll().then(setSettings)
  }, [])
  // Whole-repo toggle (project preference) + whether THIS conversation actually
  // has the repo baked in (the badge). Refetched on project/session/run changes
  // — the first send of a draft session is when its repo state gets locked.
  useEffect(() => {
    if (project)
      void window.api.repo.info().then((r) => {
        setRepoOn(r.on)
        setRepoSessionActive(r.sessionActive)
      })
  }, [project, ws.currentId, running])
  // Refresh on project switch and at task start/end — NOT per stream event
  // (an [project, items] dependency spawns git subprocesses on every delta).
  useEffect(() => {
    if (project) {
      window.api.git.isRepo().then(setIsRepo)
      window.api.git.branch().then(setBranch)
    } else {
      setBranch(null)
    }
  }, [project, running])
  // Skills feed the composer slash menu; the list is small and disk-local.
  useEffect(() => {
    if (project) void window.api.skills.list().then(setSkillList)
    else setSkillList([])
  }, [project])
  // Sub-agent activity, filtered to the viewed conversation; cleared between
  // runs so a stale line never lingers.
  useEffect(
    () =>
      window.api.agent.onSubagentActivity((msg) => {
        if (msg.sessionId === ws.currentId) setSubagent(msg.text)
      }),
    [ws.currentId]
  )
  useEffect(() => {
    if (!running) setSubagent('')
  }, [running])
  useEffect(() => {
    if (stickRef.current || justLoadedRef.current) {
      const el = scrollRef.current
      if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }))
      justLoadedRef.current = false
    }
  }, [items, running])
  // Auto-grow the composer with its content (1 line → up to ~10), so editing a
  // long prompt isn't cramped into a 2-row box (user feedback). Caps then scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [input])
  // A freshly loaded conversation always starts pinned to the bottom — and gets
  // one guaranteed scroll-to-bottom even if it was scrolled up before the switch.
  useEffect(() => {
    stickRef.current = true
    justLoadedRef.current = true
    // Assume bottom on load so the jump button doesn't flash before the
    // load-scroll lands (user report: jitter on open).
    setAtBottom(true)
  }, [ws.loaded.key])

  const setField = <K extends keyof Settings>(k: K, v: Settings[K]): void => {
    if (settings) setSettings({ ...settings, [k]: v })
    window.api.settings.set(k, v)
  }

  // Model/thinking shown for THIS project (per-project memory); the
  // globals double as the default for projects without a remembered choice.
  // Optional-chained: a stale main (HMR window) may hand over settings shaped
  // by an older schema — never let that white-screen the renderer.
  const projPref = settings && project ? settings.projectModels?.[project] : undefined
  const curModel = projPref?.model ?? settings?.model ?? 'auto'
  const curThinking: Thinking = projPref?.thinking ?? settings?.thinking ?? 'auto'
  const pickModel = (m: string, th: Thinking): void => {
    if (!settings || !project) return
    const projectModels = { ...settings.projectModels, [project]: { model: m, thinking: th } }
    setSettings({ ...settings, projectModels, model: m, thinking: th })
    void window.api.settings.set('projectModels', projectModels)
    // Globals follow the latest choice — they seed projects without a memory.
    void window.api.settings.set('model', m)
    void window.api.settings.set('thinking', th)
  }

  const submit = (): void => {
    if (!input.trim() || running) return
    // 新任务 without a folder: nudge inline, never a dialog (user direction).
    if (mode === 'home' && !homeDir) {
      setHomeNotice(t('chat.pickProjectHint'))
      return
    }
    send(input, { plan: settings?.planMode })
    setInput('')
    onStarted?.()
  }

  // Slash menu: visible only while the FIRST token is being typed.
  // Model directives + a /skill:<name> entry per project-enabled skill.
  const slashItems = useMemo(() => {
    const typed = input.trimStart()
    if (!/^\/\S*$/.test(typed)) return []
    const off = (project && settings?.skillsDisabled?.[project]) || []
    const all = [
      { token: '/pro', hint: t('slash.pro') },
      { token: '/flash', hint: t('slash.flash') },
      { token: '/think', hint: t('slash.think') },
      { token: '/fast', hint: t('slash.fast') },
      ...skillList
        .filter((s) => !off.includes(s.name))
        .map((s) => ({ token: `/skill:${s.name}`, hint: s.description || t('skills.noDesc') })),
    ]
    return all.filter((i) => i.token.startsWith(typed))
  }, [input, skillList, settings, project, t])
  useEffect(() => setSlashSel(0), [slashItems.length])
  const pickSlash = (token: string): void => {
    setInput(`${token} `)
    inputRef.current?.focus()
  }

  // ---- Composer "+" tool menu ----
  const skillsOff = (project && settings?.skillsDisabled?.[project]) || []
  const enabledSkills = skillList.filter((s) => !skillsOff.includes(s.name))
  const openToolMenu = (): void => {
    const next = !toolMenuOpen
    setToolMenuOpen(next)
    if (next && project) void window.api.mcp.status().then(setMcpServers)
  }
  const pinSkill = (name: string): void => {
    setInput((v) => (v.trim() ? `${v.trimEnd()}\n/skill:${name} ` : `/skill:${name} `))
    setToolMenuOpen(false)
    inputRef.current?.focus()
  }
  const attachFile = (): void => {
    setToolMenuOpen(false)
    void window.api.fs.attach().then((r) => {
      if (!r) return
      setInput(
        (v) => `${v}\n\n${t('tools.attached', { name: r.name })}\n\`\`\`\n${r.content}\n\`\`\`\n`
      )
      inputRef.current?.focus()
    })
  }
  useEffect(() => {
    if (!toolMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (toolMenuRef.current && !toolMenuRef.current.contains(e.target as Node)) {
        setToolMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [toolMenuOpen])

  const forkFrom = (messageId: number): void => {
    if (ws.currentId) ws.forkSession(ws.currentId, messageId)
  }
  const rewindTo = (messageId: number, text: string): void => {
    if (!ws.currentId) return
    void confirm({
      title: t('msg.rewindTitle'),
      // No git = no restore point: don't promise a file restore we can't do.
      message: t(isRepo ? 'msg.rewindConfirm' : 'msg.rewindConfirmNoGit'),
      confirmLabel: t('msg.rewindConfirmBtn'),
      danger: true,
    }).then((ok) => {
      if (!ok || !ws.currentId) return
      ws.rewindSession(ws.currentId, messageId)
      // Put the rewound message back in the composer so it's ready to edit/resend.
      setInput(text)
      setTimeout(() => inputRef.current?.focus(), 0)
    })
  }

  // One-click hand-off: leave plan mode and execute the plan just produced.
  const executePlan = (): void => {
    if (running) return
    if (settings) setSettings({ ...settings, planMode: false })
    // Persist planMode=false BEFORE sending, so the agent runs with writes enabled.
    void window.api.settings.set('planMode', false).then(() => {
      send(t('plan.executeMsg'), { plan: false })
    })
  }

  if (!project) {
    return (
      <div className="chat-empty">
        <h1>VibeSeek</h1>
        <p>{t('chat.pickProjectHint')}</p>
        <button className="btn" onClick={ws.pickProject}>
          {t('chat.pickProject')}
        </button>
      </div>
    )
  }

  // The dashboard (home + expanded stats) is a data-viewing surface, not a task
  // entry point: no composer, no git nudge there. The git banner belongs where
  // a task on THIS project can start — conversations and the project home —
  // not on the global home / dashboard (user feedback, two rounds).
  const isDashboard = mode === 'home' && statsOpen
  const showGitBanner = !isRepo && (mode === 'plain' || mode === 'project' || items.length > 0)
  // 视觉系统 (user-picked): interactive dot field behind the HOME and
  // PROJECT-HOME pages, full-bleed — working views (transcripts) stay clean.
  const showHomeBg = items.length === 0 && ((mode === 'home' && !statsOpen) || mode === 'project')

  return (
    <div className="chat">
      {showGitBanner && (
        <div className="git-banner">
          <span>{t('git.notRepo')}</span>
          <button
            className="btn-ghost"
            onClick={() => void window.api.git.init().then(() => setIsRepo(true))}
          >
            {t('git.init')}
          </button>
        </div>
      )}
      <div className="chat-body">
        {showHomeBg && (
          <div className="view-bg" aria-hidden>
            <DotField
              baseColor={
                theme === 'light' ? 'rgba(90, 110, 165, 0.28)' : 'rgba(150, 165, 220, 0.22)'
              }
              activeColor={theme === 'light' ? '#3b6df0' : '#6d96ff'}
            />
          </div>
        )}
        <div
          className={showHomeBg ? 'chat-scroll is-landing' : 'chat-scroll'}
          ref={scrollRef}
          onScroll={() => {
            const el = scrollRef.current
            if (!el) return
            const dist = el.scrollHeight - el.scrollTop - el.clientHeight
            stickRef.current = dist < 60
            setAtBottom(dist < 120)
          }}
        >
          {items.length === 0 &&
            (mode === 'home' ? (
              <Achievements
                onPick={(text) => {
                  setInput(text)
                  inputRef.current?.focus()
                }}
                statsOpen={statsOpen}
                onToggleStats={() => onToggleStats?.()}
                onShowReceipt={(target) => onShowReceipt?.(target)}
              />
            ) : mode === 'project' ? (
              <ProjectStatsPanel dir={project} name={project ? ws.nameOf(project) : ''} />
            ) : (
              <div className="chat-hint prose dim">{t('chat.startHint')}</div>
            ))}
          {items.map((item, i) =>
            item.kind === 'user' ? (
              <div key={i} className="msg user">
                <div className="msg-body">{item.text}</div>
                <MsgToolbar
                  text={item.text}
                  ts={item.ts}
                  id={item.id}
                  onFork={forkFrom}
                  onRewind={rewindTo}
                />
              </div>
            ) : item.kind === 'error' ? (
              <div key={i} className="msg-error">
                {item.text}
              </div>
            ) : item.kind === 'notice' ? (
              <div key={i} className="msg-notice">
                {item.text}
              </div>
            ) : (
              <AssistantItem
                key={i}
                item={item}
                canExecutePlan={
                  !!item.plan && item.done && !!item.text && !running && i === items.length - 1
                }
                onExecutePlan={executePlan}
                onFork={forkFrom}
              />
            )
          )}
          {running && <RunningLine startedAt={runStartedAt} model={runModel} subagent={subagent} />}
        </div>
        {mode !== 'home' && !atBottom && (
          <button
            className="jump-bottom"
            aria-label={t('chat.jumpBottom')}
            onClick={() => {
              const el = scrollRef.current
              if (el) {
                stickRef.current = true
                setAtBottom(true)
                // Instant, not smooth: a smooth scroll fires onScroll repeatedly
                // mid-flight and flickers the button (user report). Jump cleanly.
                el.scrollTop = el.scrollHeight
              }
            }}
          >
            ↓
          </button>
        )}
      </div>

      {!isDashboard && (
        <div className="composer">
          <div className="composer-meta">
            <button
              ref={chipRef}
              className={projectChosen ? 'chip proj-chip' : 'chip proj-chip chip-empty'}
              title={projectChosen ? project : t('chat.pickProjectHint')}
              onClick={() => {
                const r = chipRef.current?.getBoundingClientRect()
                if (r) setProjMenu({ x: r.left, y: r.top - 6 })
              }}
            >
              <Folder size={12} className="chip-icon" />{' '}
              {projectChosen ? ws.nameOf(project) : t('chat.pickProject')}
            </button>
            {projectChosen && branch && (
              <span className="chip branch-chip mono" title={t('chip.branchTitle')}>
                <GitBranch size={11} /> {branch}
              </span>
            )}
            {projectChosen && repoSessionActive && (
              <span className="chip repo-chip" title={t('repo.badgeHint')}>
                <BookMarked size={11} /> {t('repo.badge')}
              </span>
            )}
            {homeNotice && <span className="chip-notice">{homeNotice}</span>}
          </div>
          <div className="composer-input-wrap">
            {slashItems.length > 0 && (
              <div className="slash-menu">
                {slashItems.map((it, i) => (
                  <button
                    key={it.token}
                    className={i === slashSel ? 'slash-item active' : 'slash-item'}
                    onMouseEnter={() => setSlashSel(i)}
                    onClick={() => pickSlash(it.token)}
                  >
                    <span className="mono slash-token">{it.token}</span>
                    <span className="slash-hint">{it.hint}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              className="composer-input"
              placeholder={t('chat.placeholder')}
              value={input}
              rows={1}
              // Re-sync the settings snapshot on focus: toggles changed in the
              // Settings modal (skill disables, plan mode) must reach the
              // slash-menu filter without an app reload.
              onFocus={() => {
                void window.api.settings.getAll().then(setSettings)
                if (project) void window.api.skills.list().then(setSkillList)
              }}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // IME composition: Enter confirms the candidate, never submits
                // or picks a slash item (CJK input would break otherwise).
                if (e.nativeEvent.isComposing) return
                // While the slash menu is open, the keyboard drives IT first.
                if (slashItems.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setSlashSel((s) => (s + 1) % slashItems.length)
                    return
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setSlashSel((s) => (s - 1 + slashItems.length) % slashItems.length)
                    return
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    pickSlash(slashItems[slashSel].token)
                    return
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
                if (e.key === 'Escape' && running) abort()
              }}
            />
          </div>
          <div className="composer-bar">
            <div className="composer-controls">
              {settings && (
                <>
                  <div className="tool-menu-wrap" ref={toolMenuRef}>
                    <button
                      className={toolMenuOpen ? 'capsule tool-plus on' : 'capsule tool-plus'}
                      title={t('tools.menuTitle')}
                      onClick={openToolMenu}
                    >
                      <Plus size={14} />
                    </button>
                    {toolMenuOpen && (
                      <div className="tool-menu">
                        <div className="tool-menu-group">
                          <div className="tool-menu-label">{t('tools.attach')}</div>
                          <button className="tool-menu-item" onClick={attachFile}>
                            <Paperclip size={13} /> {t('tools.attachFile')}
                          </button>
                          <button
                            className="tool-menu-item is-disabled"
                            disabled
                            title={t('tools.imageSoon')}
                          >
                            <ImageIcon size={13} /> {t('tools.attachImage')}
                            <span className="tool-menu-soon">{t('tools.soon')}</span>
                          </button>
                        </div>
                        <div className="tool-menu-group">
                          <div className="tool-menu-label">{t('tools.skills')}</div>
                          {enabledSkills.length === 0 ? (
                            <div className="tool-menu-empty">{t('tools.noSkills')}</div>
                          ) : (
                            enabledSkills.map((s) => (
                              <button
                                key={s.name}
                                className="tool-menu-item"
                                title={s.description}
                                onClick={() => pinSkill(s.name)}
                              >
                                <Puzzle size={13} />{' '}
                                <span className="tool-menu-name">{s.name}</span>
                              </button>
                            ))
                          )}
                        </div>
                        <div className="tool-menu-group">
                          <div className="tool-menu-label">{t('tools.mcp')}</div>
                          {mcpServers.length === 0 ? (
                            <div className="tool-menu-empty">{t('tools.noMcp')}</div>
                          ) : (
                            mcpServers.map((m) => (
                              <div key={m.name} className="tool-menu-item is-static">
                                <span className={m.connected ? 'mcp-dot on' : 'mcp-dot'} />
                                <span className="tool-menu-name">{m.name}</span>
                                <span className="tool-menu-soon">{m.toolCount}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <AccessMenu
                    value={settings.permissionMode}
                    onChange={(v) => setField('permissionMode', v)}
                  />
                  <button
                    className={settings.planMode ? 'capsule plan-toggle on' : 'capsule plan-toggle'}
                    title={t('plan.hint')}
                    onClick={() => setField('planMode', !settings.planMode)}
                  >
                    <span className="plan-knob" /> {t('plan.toggle')}
                  </button>
                  <ModelPicker model={curModel} thinking={curThinking} onChange={pickModel} />
                  {/* Whole-repo is locked at conversation start, so the toggle
                      only makes sense BEFORE the first message. Once a chat has
                      turns, the 📚 badge above shows its (fixed) state instead. */}
                  {items.length === 0 && (
                    <button
                      className={repoOn ? 'capsule repo-toggle on' : 'capsule repo-toggle'}
                      title={t('repo.hint')}
                      onClick={() => {
                        if (repoOn) {
                          setRepoOn(false)
                          void window.api.repo.setMode(false)
                          return
                        }
                        void confirm({
                          title: t('repo.onTitle'),
                          message: t('repo.onExplain'),
                          confirmLabel: t('repo.onConfirm'),
                        }).then((okToOn) => {
                          if (!okToOn) return
                          setRepoOn(true)
                          void window.api.repo.setMode(true)
                        })
                      }}
                    >
                      <BookMarked size={12} /> {t('repo.toggle')}
                    </button>
                  )}
                </>
              )}
            </div>
            {running ? (
              <button className="btn btn-stop" onClick={abort}>
                {t('chat.stop')}
              </button>
            ) : (
              <button className="btn" onClick={submit} disabled={!input.trim()}>
                {t('chat.send')}
              </button>
            )}
          </div>
        </div>
      )}

      {projMenu && (
        <ContextMenu
          x={projMenu.x}
          y={projMenu.y}
          items={
            [
              ...ws.recents.map(
                (dir): MenuItem => ({
                  label: ws.nameOf(dir),
                  checked: projectChosen && dir === project,
                  onClick: () => {
                    if (dir !== project) ws.switchProject(dir)
                    if (mode === 'home') chooseHomeDir(dir, true)
                  },
                })
              ),
              { separator: true, label: '' },
              {
                label: t('chip.openFolder'),
                onClick: () => {
                  void window.api.project.pick().then((dir) => {
                    if (typeof dir !== 'string' || !dir) return
                    if (mode === 'home') chooseHomeDir(dir, ws.recents.includes(dir))
                  })
                },
              },
            ] satisfies MenuItem[]
          }
          onClose={() => setProjMenu(null)}
        />
      )}
    </div>
  )
}
