import { useEffect, useState } from 'react'

/** Live <html data-theme>, so canvas/WebGL colors follow the theme switch. */
export function useThemeAttr(): string {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'dark')
  useEffect(() => {
    const mo = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme ?? 'dark')
    )
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return theme
}
