import { describe, it, expect } from 'vitest'
import { createShell } from './shell'

describe('shell', () => {
  it('reports the current platform', () => {
    const shell = createShell()
    expect(['win32', 'darwin', 'linux']).toContain(shell.platform)
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
