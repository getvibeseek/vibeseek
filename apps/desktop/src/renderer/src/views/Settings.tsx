import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { useConfirm } from '../components/Confirm'
import { applyTheme } from '../hooks/useTheme'
import { CHANGELOG } from '../changelog'
import type { Settings as SettingsData } from '../../../shared/settings'
import type {
  ApiKeyStatus,
  MemoryFileInfo,
  MemoryScope,
  SkillInfo,
  McpStatus,
} from '../../../shared/ipc'

type SectionId = 'api' | 'memory' | 'skills' | 'appearance' | 'updates' | 'about'

/** iOS-style switch (user feedback: 不用勾选框). Module-level so React keeps
 *  the DOM node across renders and the slide transition actually plays. */
function Switch({
  on,
  title,
  onToggle,
}: {
  on: boolean
  title: string
  onToggle: () => void
}): JSX.Element {
  return (
    <label className="switch" title={title}>
      <input type="checkbox" checked={on} onChange={onToggle} />
      <span className="switch-slider" />
    </label>
  )
}

/** 设置→技能: skills from the project AND global roots
 *  (~/.claude/skills, ~/.vibeseek/skills), with per-project enable toggles,
 *  an import button, and an MCP add-server form. Toggles affect NEW
 *  conversations only — a session's tool set is frozen when it starts. */
function SkillsSection(): JSX.Element {
  const { t } = useTranslation()
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [servers, setServers] = useState<McpStatus[]>([])
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [mcpForm, setMcpForm] = useState(false)
  const [mcpName, setMcpName] = useState('')
  const [mcpCmd, setMcpCmd] = useState('')
  const [mcpArgs, setMcpArgs] = useState('')
  const [mcpMsg, setMcpMsg] = useState<string | null>(null)

  const refresh = (): void => {
    void window.api.skills.list().then(setSkills)
    void window.api.mcp.status().then(setServers)
    void window.api.settings.getAll().then(setSettings)
  }
  useEffect(refresh, [])

  const project = settings?.projectDir ?? null
  const skillsOff = (project && settings?.skillsDisabled?.[project]) || []
  const mcpOff = (project && settings?.mcpDisabled?.[project]) || []

  const toggleDisabled = (
    key: 'skillsDisabled' | 'mcpDisabled',
    current: string[],
    name: string
  ): void => {
    if (!settings || !project) return
    const list = current.includes(name) ? current.filter((n) => n !== name) : [...current, name]
    const next = { ...settings[key], [project]: list }
    setSettings({ ...settings, [key]: next })
    void window.api.settings.set(key, next)
  }

  const doImport = (): void => {
    void window.api.skills.import().then((r) => {
      if (r.ok) {
        setImportMsg(t('skills.imported', { name: r.name }))
        refresh()
      } else if (r.error === 'noSkillMd') {
        setImportMsg(t('skills.noSkillMd'))
      }
    })
  }

  const doAddMcp = (): void => {
    void window.api.mcp.add(mcpName, mcpCmd, mcpArgs).then((ok) => {
      if (ok) {
        setMcpMsg(t('mcp.added'))
        setMcpForm(false)
        setMcpName('')
        setMcpCmd('')
        setMcpArgs('')
        refresh()
      }
    })
  }

  return (
    <>
      <section className="settings-group">
        <div className="settings-row-head">
          <label className="settings-label">{t('skills.title')}</label>
          <button className="btn-ghost" onClick={doImport}>
            {t('skills.import')}
          </button>
          <button className="btn-ghost" onClick={() => window.api.skills.openDir()}>
            {t('skills.openDir')}
          </button>
        </div>
        <p className="settings-hint">{importMsg ?? t('skills.hint')}</p>
        {skills.length === 0 && <p className="settings-hint">{t('skills.empty')}</p>}
        {skills.map((s) => (
          <div key={s.source} className="skill-row" title={s.description || t('skills.noDesc')}>
            {project && (
              <Switch
                on={!skillsOff.includes(s.name)}
                title={t('skills.switchHint')}
                onToggle={() => toggleDisabled('skillsDisabled', skillsOff, s.name)}
              />
            )}
            <span className="skill-name mono">{s.name}</span>
            <span className="skill-scope">
              {t(s.scope === 'global' ? 'skills.scopeGlobal' : 'skills.scopeProject')}
            </span>
            <span className="skill-desc skill-desc-inline">
              {s.description || t('skills.noDesc')}
            </span>
          </div>
        ))}
      </section>
      <section className="settings-group">
        <div className="settings-row-head">
          <label className="settings-label">{t('mcp.title')}</label>
          {project && (
            <button className="btn-ghost" onClick={() => setMcpForm((v) => !v)}>
              {t('mcp.add')}
            </button>
          )}
        </div>
        <p className="settings-hint">{mcpMsg ?? t('mcp.hint')}</p>
        {mcpForm && (
          <div className="mcp-form">
            <p className="settings-hint mcp-warning">⚠ {t('mcp.addSecurity')}</p>
            <input
              className="input"
              placeholder={t('mcp.addName')}
              value={mcpName}
              onChange={(e) => setMcpName(e.target.value)}
            />
            <input
              className="input mono"
              placeholder={t('mcp.addCommand')}
              value={mcpCmd}
              onChange={(e) => setMcpCmd(e.target.value)}
            />
            <input
              className="input mono"
              placeholder={t('mcp.addArgs')}
              value={mcpArgs}
              onChange={(e) => setMcpArgs(e.target.value)}
            />
            <button className="btn" disabled={!mcpName.trim() || !mcpCmd.trim()} onClick={doAddMcp}>
              {t('mcp.addConfirm')}
            </button>
          </div>
        )}
        {servers.length === 0 && <p className="settings-hint">{t('mcp.empty')}</p>}
        {servers.map((s) => (
          <div key={s.name} className="skill-row" title={s.command}>
            {project && (
              <Switch
                on={!mcpOff.includes(s.name)}
                title={t('skills.switchHint')}
                onToggle={() => toggleDisabled('mcpDisabled', mcpOff, s.name)}
              />
            )}
            <span className="skill-name mono">
              <span className={s.connected ? 'mcp-dot ok' : 'mcp-dot'} /> {s.name}
            </span>
            {s.connected && (
              <span className="skill-scope">{t('mcp.tools', { n: s.toolCount })}</span>
            )}
            <span className="skill-desc skill-desc-inline mono">{s.command}</span>
          </div>
        ))}
      </section>
    </>
  )
}

/** 设置→记忆 (transparency rule): every memory file is visible, editable
 * and deletable — the agent never remembers anything behind the user's back. */
function MemorySection(): JSX.Element {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const [scope, setScope] = useState<MemoryScope>('project')
  const [files, setFiles] = useState<MemoryFileInfo[]>([])
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [savedTick, setSavedTick] = useState(false)
  const [enabled, setEnabled] = useState(true)

  const refresh = (s: MemoryScope): void => {
    void window.api.memory.list(s).then(setFiles)
  }
  useEffect(() => {
    void window.api.settings.getAll().then((st) => setEnabled(st.memoryEnabled !== false))
  }, [])
  useEffect(() => {
    setOpenFile(null)
    refresh(scope)
  }, [scope])

  const open = (name: string): void => {
    void window.api.memory.read(name, scope).then((c) => {
      setOpenFile(name)
      setContent(c)
    })
  }

  // Global MEMORY.md may not exist yet — open a blank editor to author it.
  const createGlobal = (): void => {
    setOpenFile('MEMORY.md')
    setContent('')
  }

  const save = (): void => {
    if (!openFile) return
    void window.api.memory.write(openFile, content, scope).then(() => {
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 1500)
      refresh(scope)
    })
  }

  const remove = (name: string): void => {
    void confirm({
      title: t('memory.delete'),
      message: t('memory.deleteConfirm'),
      confirmLabel: t('memory.delete'),
      danger: true,
    }).then((ok) => {
      if (!ok) return
      void window.api.memory.remove(name, scope).then(() => {
        if (openFile === name) setOpenFile(null)
        refresh(scope)
      })
    })
  }

  const toggleEnabled = (): void => {
    const next = !enabled
    setEnabled(next)
    void window.api.settings.set('memoryEnabled', next)
  }

  return (
    <>
      <section className="settings-group">
        <div className="settings-row">
          <label className="settings-label">{t('memory.title')}</label>
          <Switch on={enabled} title={t('memory.enabledHint')} onToggle={toggleEnabled} />
        </div>
        <p className="settings-hint">{enabled ? t('memory.hint') : t('memory.disabledHint')}</p>
        <div className="settings-row memory-scope">
          <button
            className={scope === 'project' ? 'btn' : 'btn-ghost'}
            onClick={() => setScope('project')}
          >
            {t('memory.scopeProject')}
          </button>
          <button
            className={scope === 'global' ? 'btn' : 'btn-ghost'}
            onClick={() => setScope('global')}
          >
            {t('memory.scopeGlobal')}
          </button>
        </div>
        <p className="settings-hint">
          {scope === 'global' ? t('memory.globalHint') : t('memory.projectHint')}
        </p>
        {files.length === 0 &&
          (scope === 'global' ? (
            <button className="btn-ghost" onClick={createGlobal}>
              {t('memory.createGlobal')}
            </button>
          ) : (
            <p className="settings-hint">{t('memory.empty')}</p>
          ))}
        {files.map((f) => (
          <div key={f.name} className="settings-row memory-row">
            <button
              className={openFile === f.name ? 'memory-file active mono' : 'memory-file mono'}
              onClick={() => open(f.name)}
            >
              {f.name}
            </button>
            <span className="settings-hint tnum">{(f.size / 1024).toFixed(1)} KB</span>
            <button className="btn-ghost" onClick={() => remove(f.name)}>
              {t('memory.delete')}
            </button>
          </div>
        ))}
      </section>
      {openFile && (
        <section className="settings-group">
          <label className="settings-label mono">{openFile}</label>
          <textarea
            className="input mono memory-editor"
            value={content}
            rows={14}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="settings-row">
            <button className="btn" onClick={save}>
              {t('settings.save')}
            </button>
            {savedTick && <span className="settings-hint">{t('memory.saved')}</span>}
          </div>
        </section>
      )}
    </>
  )
}

/** Two-pane settings (二轮修订): section nav on the left, content right. */
export function Settings(): JSX.Element {
  const { t } = useTranslation()
  const [section, setSection] = useState<SectionId>('api')
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus>({ hasKey: false, masked: null })
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState('')
  const [resetDone, setResetDone] = useState(false)
  const confirm = useConfirm()

  useEffect(() => {
    window.api.settings.getAll().then(setSettings)
    window.api.apiKey.status().then(setKeyStatus)
  }, [])

  if (!settings) return <div className="settings">{t('common.loading')}</div>

  const update = <K extends keyof SettingsData>(key: K, value: SettingsData[K]): void => {
    setSettings({ ...settings, [key]: value })
    window.api.settings.set(key, value)
    if (key === 'theme') applyTheme(value as SettingsData['theme'])
    if (key === 'locale') void i18n.changeLanguage(value as string)
  }

  const saveKey = async (): Promise<void> => {
    if (!keyInput.trim()) return
    setSaving(true)
    try {
      const status = await window.api.apiKey.set(keyInput)
      setKeyStatus(status)
      setKeyInput('')
    } finally {
      setSaving(false)
    }
  }

  const clearKey = async (): Promise<void> => {
    await window.api.apiKey.clear()
    setKeyStatus({ hasKey: false, masked: null })
  }

  const sections: Array<{ id: SectionId; label: string }> = [
    { id: 'api', label: t('settings.nav.api') },
    { id: 'memory', label: t('settings.nav.memory') },
    { id: 'skills', label: t('settings.nav.skills') },
    // 技能 section also hosts MCP servers.
    { id: 'appearance', label: t('settings.nav.appearance') },
    { id: 'updates', label: t('settings.nav.updates') },
    { id: 'about', label: t('settings.nav.about') },
  ]

  return (
    <div className="settings-panes">
      <nav className="settings-nav">
        {sections.map((s) => (
          <button
            key={s.id}
            className={section === s.id ? 'settings-nav-item active' : 'settings-nav-item'}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="settings-content">
        {section === 'api' && (
          <>
            <section className="settings-group">
              <label className="settings-label">{t('settings.apiKey')}</label>
              {keyStatus.hasKey && (
                <div className="settings-row">
                  <span className="settings-hint mono">
                    {t('settings.saved', { masked: keyStatus.masked })}
                  </span>
                  <button className="btn-ghost" onClick={clearKey}>
                    {t('settings.clear')}
                  </button>
                </div>
              )}
              <div className="settings-row">
                <input
                  type="password"
                  className="input mono"
                  placeholder={t('settings.keyPlaceholder')}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveKey()}
                />
                <button className="btn" onClick={saveKey} disabled={saving || !keyInput.trim()}>
                  {saving ? t('settings.saving') : t('settings.save')}
                </button>
              </div>
              <p className="settings-hint">{t('settings.keyHint')}</p>
            </section>

            <section className="settings-group">
              <label className="settings-label">{t('settings.baseUrl')}</label>
              <input
                type="text"
                className="input mono"
                value={settings.baseUrl}
                onChange={(e) => update('baseUrl', e.target.value)}
              />
              <p className="settings-hint">{t('settings.baseUrlHint')}</p>
            </section>

            <section className="settings-group">
              <label className="settings-label">{t('settings.budget')}</label>
              <input
                type="number"
                step="0.1"
                min="0"
                className="input mono"
                value={settings.taskBudget ?? ''}
                onChange={(e) =>
                  update('taskBudget', e.target.value === '' ? null : Number(e.target.value))
                }
              />
              <p className="settings-hint">{t('settings.budgetHint')}</p>
            </section>

            <section className="settings-group">
              <label className="settings-label">{t('settings.alerts')}</label>
              <div className="settings-row">
                <span className="settings-hint">{t('settings.balanceAlert')}</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="input mono"
                  value={settings.balanceAlertYuan ?? ''}
                  onChange={(e) =>
                    update(
                      'balanceAlertYuan',
                      e.target.value === '' ? null : Number(e.target.value)
                    )
                  }
                />
              </div>
              <div className="settings-row">
                <span className="settings-hint">{t('settings.dayCostAlert')}</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="input mono"
                  value={settings.dayCostAlertYuan ?? ''}
                  onChange={(e) =>
                    update(
                      'dayCostAlertYuan',
                      e.target.value === '' ? null : Number(e.target.value)
                    )
                  }
                />
              </div>
              <p className="settings-hint">{t('settings.alertsHint')}</p>
            </section>
          </>
        )}

        {section === 'memory' && <MemorySection />}

        {section === 'skills' && <SkillsSection />}

        {section === 'appearance' && (
          <>
            <section className="settings-group">
              <label className="settings-label">{t('settings.theme')}</label>
              <select
                className="input"
                value={settings.theme}
                onChange={(e) => update('theme', e.target.value as SettingsData['theme'])}
              >
                <option value="dark">{t('settings.themeDark')}</option>
                <option value="light">{t('settings.themeLight')}</option>
                <option value="system">{t('settings.themeSystem')}</option>
              </select>
            </section>

            <section className="settings-group">
              <label className="settings-label">{t('settings.language')}</label>
              <select
                className="input"
                value={settings.locale}
                onChange={(e) => update('locale', e.target.value)}
              >
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </section>

            <section className="settings-group">
              <label className="settings-label">{t('settings.zoom')}</label>
              <p className="settings-hint">{t('settings.zoomHint')}</p>
            </section>
          </>
        )}

        {section === 'updates' && (
          <>
            <section className="settings-group">
              <label className="settings-label">{t('settings.updatesTitle')}</label>
              <p className="settings-hint">{t('settings.updatesIntro')}</p>
            </section>
            {CHANGELOG.map((e) => (
              <section key={e.version} className="settings-group changelog-entry">
                <div className="changelog-head">
                  <span className="changelog-version mono">v{e.version}</span>
                  <span className="settings-hint tnum">{e.date}</span>
                </div>
                <ul className="changelog-list">
                  {(i18n.language.startsWith('zh') ? e.zh : e.en).map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}

        {section === 'about' && (
          <>
            <section className="settings-group">
              <label className="settings-label">VibeSeek</label>
              <p className="settings-hint">{t('app.tagline')}</p>
            </section>
            <section className="settings-group">
              <label className="settings-label">{t('settings.diagnostics')}</label>
              <div className="settings-row">
                <button
                  className="btn"
                  disabled={exporting}
                  onClick={() => {
                    setExporting(true)
                    void window.api.diagnostics
                      .export()
                      .then((p) => setExported(p ? t('settings.exported') : ''))
                      .finally(() => setExporting(false))
                  }}
                >
                  {exporting ? t('settings.exporting') : t('settings.exportDiag')}
                </button>
                <button className="btn-ghost" onClick={() => window.api.logs.openDir()}>
                  {t('usage.openLogs')}
                </button>
                {exported && <span className="settings-hint">{exported}</span>}
              </div>
              <p className="settings-hint">{t('settings.diagnosticsHint')}</p>
            </section>
            <section className="settings-group">
              <label className="settings-label">{t('settings.replayOnboarding')}</label>
              <div className="settings-row">
                <button
                  className="btn-ghost"
                  onClick={() => {
                    void window.api.settings.set('onboarded', false).then(() => {
                      window.location.reload()
                    })
                  }}
                >
                  {t('settings.replayOnboardingBtn')}
                </button>
              </div>
              <p className="settings-hint">{t('settings.replayOnboardingHint')}</p>
            </section>
            <section className="settings-group">
              <label className="settings-label">{t('settings.resetStats')}</label>
              <div className="settings-row">
                <button
                  className="btn-ghost"
                  onClick={() => {
                    void confirm({
                      title: t('settings.resetStats'),
                      message: t('settings.resetStatsConfirm'),
                      confirmLabel: t('settings.resetStatsBtn'),
                      danger: true,
                    }).then((ok) => {
                      if (!ok) return
                      void window.api.usage.reset().then(() => setResetDone(true))
                    })
                  }}
                >
                  {t('settings.resetStatsBtn')}
                </button>
                {resetDone && <span className="settings-hint">{t('settings.resetDone')}</span>}
              </div>
              <p className="settings-hint">{t('settings.resetStatsHint')}</p>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
