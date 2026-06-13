import { describe, it, expect } from 'vitest'
import { classifyCommand } from './classify'
import { PolicyEngine } from './engine'

describe('classifyCommand', () => {
  it('flags dangerous commands', () => {
    expect(classifyCommand('rm -rf /')).toBe('dangerous')
    expect(classifyCommand('git push --force origin main')).toBe('dangerous')
    expect(classifyCommand('del /f /q C:\\x')).toBe('dangerous')
    expect(classifyCommand('reg add HKLM\\x')).toBe('dangerous')
    expect(classifyCommand('Remove-Item -Recurse -Force .')).toBe('dangerous')
  })
  it('allows read-only commands', () => {
    expect(classifyCommand('ls -la')).toBe('readonly')
    expect(classifyCommand('git status')).toBe('readonly')
    expect(classifyCommand('git diff HEAD')).toBe('readonly')
    expect(classifyCommand('grep foo src')).toBe('readonly')
  })
  it('treats everything else as write', () => {
    expect(classifyCommand('pnpm install')).toBe('write')
    expect(classifyCommand('mkdir foo')).toBe('write')
    expect(classifyCommand('git status && rm x')).toBe('write') // chained -> write
  })
})

const write = { toolName: 'write_file', input: {}, isReadOnly: false }
const read = { toolName: 'read_file', input: {}, isReadOnly: true }
const danger = { toolName: 'shell', input: { command: 'rm -rf /' }, isReadOnly: false }

describe('PolicyEngine', () => {
  it('plan mode allows only read-only', () => {
    const p = new PolicyEngine('plan')
    expect(p.decide(read)).toBe('allow')
    expect(p.decide(write)).toBe('deny')
  })

  it('standard mode confirms writes, allows reads', () => {
    const p = new PolicyEngine('standard')
    expect(p.decide(read)).toBe('allow')
    expect(p.decide(write)).toBe('confirm')
  })

  it('standard mode auto-allows an allowlisted tool', () => {
    const p = new PolicyEngine('standard', [{ tool: 'write_file', scope: 'project' }])
    expect(p.decide(write)).toBe('allow')
  })

  it('yolo allows writes but still confirms dangerous commands', () => {
    const p = new PolicyEngine('yolo')
    expect(p.decide(write)).toBe('allow')
    expect(p.decide(danger)).toBe('confirm')
  })

  it('dangerous commands confirm even when the tool is allowlisted', () => {
    const p = new PolicyEngine('standard', [{ tool: 'shell', scope: 'project' }])
    expect(p.decide(danger)).toBe('confirm')
    // but a benign shell command is allowed via the allowlist
    expect(
      p.decide({ toolName: 'shell', input: { command: 'pnpm build' }, isReadOnly: false })
    ).toBe('allow')
  })

  it('addRule updates the allowlist at runtime', () => {
    const p = new PolicyEngine('standard')
    expect(p.decide(write)).toBe('confirm')
    p.addRule('write_file')
    expect(p.decide(write)).toBe('allow')
  })
})
