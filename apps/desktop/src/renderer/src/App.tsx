import { useState, useEffect } from 'react'
import i18n from './i18n'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { SidePanel, type PanelTab } from './components/SidePanel'
import { PermissionDialog } from './components/PermissionDialog'
import { SettingsModal } from './components/SettingsModal'
import { ReceiptPopover, type ReceiptTarget } from './components/ReceiptPopover'
import { DevPanel } from './components/DevPanel'
import { SearchModal } from './components/SearchModal'
import { Onboarding } from './components/Onboarding'
import { Chat } from './views/Chat'
import { ClickSpark } from './components/fx/ClickSpark'
import { useTheme } from './hooks/useTheme'
import { useZoom } from './hooks/useZoom'
import { useWorkspace } from './hooks/useWorkspace'

type View = 'home' | 'project' | 'chat'

function App(): JSX.Element {
  const [view, setView] = useState<View>('home')
  // Home page's「详细统计」expansion — sidebar's 仪表盘 entry = home in this state.
  const [statsOpen, setStatsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [devOpen, setDevOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // Right-side panel: which tab is open, if any.
  const [panel, setPanel] = useState<PanelTab | null>(null)
  const [changeCount, setChangeCount] = useState(0)
  const [receiptTarget, setReceiptTarget] = useState<ReceiptTarget | null>(null)
  // null = still loading; gate first-run onboarding on it.
  const [onboarded, setOnboarded] = useState<boolean | null>(null)
  useTheme()
  useZoom()
  const ws = useWorkspace()

  useEffect(() => {
    window.api.settings.getAll().then((s) => {
      if (s.locale !== i18n.language) void i18n.changeLanguage(s.locale)
      setOnboarded(s.onboarded === true)
    })
  }, [])

  // Developer panel (Ctrl+Shift+D) + conversation search (Ctrl+K).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setDevOpen((v) => !v)
      }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Opening a conversation returns to the chat view; mere deselection doesn't.
  useEffect(() => {
    if (ws.currentId) setView('chat')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.loaded.key])

  // Change count feeds the 变更 tab badge on the status bar.
  useEffect(() => {
    const refresh = (): void => void window.api.changes.list().then((c) => setChangeCount(c.length))
    refresh()
    return window.api.changes.onUpdate(refresh)
  }, [])

  return (
    <div className="app">
      <ClickSpark />
      <TitleBar />
      <div className="app-main">
        <Sidebar
          ws={ws}
          onNewTask={() => {
            ws.deselect()
            setView('home')
            setStatsOpen(false)
          }}
          onOpenProject={() => setView('project')}
          // "+" in a project lands on the same project home as clicking the row
          // (user feedback: the two entry points should look identical). A fresh
          // draft is already set up by focusProject; sending lazily creates the
          // session and flips to the chat view.
          onNewInProject={() => setView('project')}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenDashboard={() => {
            const active = view === 'home' && statsOpen
            ws.deselect()
            setView('home')
            setStatsOpen(!active)
          }}
          dashboardActive={view === 'home' && statsOpen}
          suppressProjectActive={view === 'home'}
          onShowReceipt={setReceiptTarget}
        />
        <main className="app-content">
          <Chat
            ws={ws}
            mode={view === 'home' ? 'home' : view === 'project' ? 'project' : 'plain'}
            onStarted={() => setView('chat')}
            statsOpen={view === 'home' && statsOpen}
            onToggleStats={() => setStatsOpen((v) => !v)}
            onShowReceipt={setReceiptTarget}
          />
        </main>
        {panel && (
          <SidePanel
            tab={panel}
            changeCount={changeCount}
            onTab={setPanel}
            onClose={() => setPanel(null)}
          />
        )}
        {devOpen && <DevPanel onClose={() => setDevOpen(false)} />}
      </div>
      <StatusBar
        ws={ws}
        onShowReceipt={setReceiptTarget}
        panel={panel}
        changeCount={changeCount}
        onTogglePanel={(tab) => setPanel((p) => (p === tab ? null : tab))}
      />
      <PermissionDialog />
      {searchOpen && (
        <SearchModal
          onClose={() => setSearchOpen(false)}
          onPick={(id) => ws.selectSession(id)}
          nameOf={ws.nameOf}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {receiptTarget && (
        <ReceiptPopover target={receiptTarget} onClose={() => setReceiptTarget(null)} />
      )}
      {onboarded === false && <Onboarding onDone={() => setOnboarded(true)} />}
    </div>
  )
}

export default App
