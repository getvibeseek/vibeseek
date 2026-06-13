import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Monitor, Sun, Moon, BookMarked, ShieldCheck, ListChecks, ReceiptText } from 'lucide-react'
import { applyTheme } from '../hooks/useTheme'
import type { Settings } from '../../../shared/settings'

type Theme = Settings['theme']

/**
 * First-run onboarding: pick a theme, optionally set the API key, then a
 * short tour of the features that set VibeSeek apart (full-repo first). Shown
 * once — gated on settings.onboarded. Uses the new-task page's visual language.
 */
export function Onboarding({ onDone }: { onDone: () => void }): JSX.Element {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  const [theme, setTheme] = useState<Theme>('system')
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving] = useState(false)

  const pickTheme = (v: Theme): void => {
    setTheme(v)
    applyTheme(v)
    void window.api.settings.set('theme', v)
  }

  const finish = (): void => {
    void window.api.settings.set('onboarded', true)
    onDone()
  }

  const saveKeyNext = async (): Promise<void> => {
    if (keyInput.trim()) {
      setSaving(true)
      try {
        await window.api.apiKey.set(keyInput.trim())
      } finally {
        setSaving(false)
      }
    }
    setStep(2)
  }

  const themes: Array<{ id: Theme; label: string; Icon: typeof Monitor }> = [
    { id: 'system', label: t('settings.themeSystem'), Icon: Monitor },
    { id: 'light', label: t('settings.themeLight'), Icon: Sun },
    { id: 'dark', label: t('settings.themeDark'), Icon: Moon },
  ]

  const features: Array<{ Icon: typeof Monitor; title: string; body: string }> = [
    { Icon: BookMarked, title: t('onboard.featRepoTitle'), body: t('onboard.featRepoBody') },
    { Icon: ShieldCheck, title: t('onboard.featPermTitle'), body: t('onboard.featPermBody') },
    { Icon: ListChecks, title: t('onboard.featPlanTitle'), body: t('onboard.featPlanBody') },
    { Icon: ReceiptText, title: t('onboard.featReceiptTitle'), body: t('onboard.featReceiptBody') },
  ]

  return (
    <div className="modal-overlay onboarding-overlay">
      <div className="modal onboarding glass">
        {step === 0 && (
          <>
            <h2 className="onboarding-title">{t('onboard.welcomeTitle')}</h2>
            <p className="onboarding-sub">{t('onboard.themePrompt')}</p>
            <div className="onboarding-themes">
              {themes.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={theme === id ? 'onboarding-theme active' : 'onboarding-theme'}
                  onClick={() => pickTheme(id)}
                >
                  <Icon size={22} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <div className="onboarding-actions">
              <span />
              <button className="btn" onClick={() => setStep(1)}>
                {t('onboard.next')}
              </button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="onboarding-title">{t('onboard.keyTitle')}</h2>
            <p className="onboarding-sub">{t('onboard.keyPrompt')}</p>
            <input
              type="password"
              className="input mono"
              placeholder={t('settings.keyPlaceholder')}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void saveKeyNext()}
            />
            <p className="settings-hint">{t('settings.keyHint')}</p>
            <div className="onboarding-actions">
              <button className="btn-ghost" onClick={() => setStep(2)}>
                {t('onboard.skip')}
              </button>
              <button className="btn" disabled={saving} onClick={() => void saveKeyNext()}>
                {saving ? t('settings.saving') : t('onboard.next')}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="onboarding-title">{t('onboard.featTitle')}</h2>
            <div className="onboarding-features">
              {features.map(({ Icon, title, body }) => (
                <div key={title} className="onboarding-feature">
                  <Icon size={18} className="onboarding-feature-icon" />
                  <div>
                    <div className="onboarding-feature-title">{title}</div>
                    <div className="onboarding-feature-body">{body}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="onboarding-actions">
              <button className="btn-ghost" onClick={() => setStep(1)}>
                {t('onboard.back')}
              </button>
              <button className="btn" onClick={finish}>
                {t('onboard.start')}
              </button>
            </div>
          </>
        )}

        <div className="onboarding-dots">
          {[0, 1, 2].map((i) => (
            <span key={i} className={i === step ? 'onboarding-dot active' : 'onboarding-dot'} />
          ))}
        </div>
      </div>
    </div>
  )
}
