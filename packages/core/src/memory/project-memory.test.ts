import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectMemory } from './project-memory'
import { SessionContext } from '../context/session-context'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vibeseek-mem-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('ProjectMemory', () => {
  it('round-trips MEMORY.md and checkpoints', () => {
    const mem = new ProjectMemory(dir)
    expect(mem.readMemory()).toBeNull()
    mem.writeMemory('# 项目记忆\n- 用 pnpm')
    expect(mem.readMemory()).toContain('用 pnpm')

    expect(mem.readCheckpoint('s1')).toBeNull()
    mem.writeCheckpoint('s1', '## 进度\n完成了 X')
    expect(mem.readCheckpoint('s1')).toContain('完成了 X')
    expect(mem.checkpointMtime('s1')).toBeGreaterThan(0)
  })

  it('lists, edits and removes files (设置→记忆 transparency)', () => {
    const mem = new ProjectMemory(dir)
    mem.writeMemory('knowledge')
    mem.writeCheckpoint('abc', 'snap')
    const names = mem.list().map((f) => f.name)
    expect(names).toEqual(['MEMORY.md', 'checkpoints/abc.md'])

    mem.write('MEMORY.md', 'edited')
    expect(mem.read('MEMORY.md')).toBe('edited')

    mem.remove('checkpoints/abc.md')
    expect(mem.list().map((f) => f.name)).toEqual(['MEMORY.md'])
  })

  it('rejects path traversal', () => {
    const mem = new ProjectMemory(dir)
    expect(() => mem.read('../outside.md')).toThrow()
  })

  it('makes .vibeseek self-ignoring so it never pollutes the user repo', () => {
    const mem = new ProjectMemory(dir)
    mem.writeMemory('x')
    expect(readFileSync(join(dir, '.vibeseek', '.gitignore'), 'utf8')).toBe('*\n')
  })

  it('changesFile returns a per-session ledger path under .vibeseek/changes', () => {
    const mem = new ProjectMemory(dir)
    const p = mem.changesFile('sid-1')
    expect(p).toBe(join(dir, '.vibeseek', 'changes', 'sid-1.json'))
    // The dir + self-ignore are created eagerly.
    expect(existsSync(join(dir, '.vibeseek', 'changes'))).toBe(true)
    expect(existsSync(join(dir, '.vibeseek', '.gitignore'))).toBe(true)
  })
})

describe('SessionContext.compact', () => {
  it('collapses the active layer into one user prefix head and keeps appending', () => {
    const ctx = new SessionContext({ systemPrompt: 'sys', tools: [], contextMessage: 'ctx' })
    ctx.append({ role: 'user', content: [{ type: 'text', text: '改个按钮' }] })
    ctx.append({ role: 'assistant', content: [{ type: 'text', text: '改好了'.repeat(100) }] })
    const before = ctx.estimateTokens()

    ctx.compact('[摘要] 用户要求: 改个按钮 (已完成)')
    const built = ctx.build()
    // system + contextMessage + the single summary head
    expect(built).toHaveLength(3)
    expect(built[2].role).toBe('user')
    expect(ctx.estimateTokens()).toBeLessThan(before)

    ctx.append({ role: 'user', content: [{ type: 'text', text: '继续' }] })
    expect(ctx.build()).toHaveLength(4)
  })
})
