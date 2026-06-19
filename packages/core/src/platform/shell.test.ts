import { describe, it, expect } from 'vitest'
import { createShell, enhancePosixPath } from './shell'

describe('shell', () => {
  it('reports the current platform', () => {
    const shell = createShell()
    expect(['win32', 'darwin', 'linux']).toContain(shell.platform)
  })

  describe('enhancePosixPath', () => {
    it('appends Homebrew locations to a bare launchd PATH', () => {
      const out = enhancePosixPath('/usr/bin:/bin:/usr/sbin:/sbin').split(':')
      expect(out).toContain('/opt/homebrew/bin')
      expect(out).toContain('/usr/local/bin')
    })

    it('keeps inherited entries first and does not duplicate', () => {
      const out = enhancePosixPath('/opt/homebrew/bin:/usr/bin')
      expect(out.startsWith('/opt/homebrew/bin:/usr/bin')).toBe(true)
      expect(out.split(':').filter((p) => p === '/opt/homebrew/bin')).toHaveLength(1)
    })

    it('still yields a usable PATH when nothing is inherited', () => {
      const out = enhancePosixPath('').split(':')
      expect(out).toContain('/usr/bin')
      expect(out).toContain('/opt/homebrew/bin')
      expect(out).not.toContain('')
    })
  })

  it('echoes ASCII output', async () => {
    const shell = createShell()
    const { stdout, code } = await shell.run('echo hello')
    expect(code).toBe(0)
    expect(stdout.trim()).toBe('hello')
  })

  it('echoes non-ASCII (中文) without mojibake', async () => {
    const shell = createShell()
    const { stdout } = await shell.run('echo 中文')
    expect(stdout).toContain('中文')
  })
})
