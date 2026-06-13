import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GitCheckpoints } from './checkpoint'
import { createShell } from '../platform/shell'

let dir: string
let git: GitCheckpoints
const shell = createShell()

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'vibeseek-ckpt-'))
  git = new GitCheckpoints(dir, shell)
  await shell.run('git init', { cwd: dir })
  await shell.run('git config user.email t@t.co', { cwd: dir })
  await shell.run('git config user.name t', { cwd: dir })
  await shell.run('git config core.autocrlf false', { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'original\n')
  await shell.run('git add -A', { cwd: dir })
  await shell.run('git commit -m init', { cwd: dir })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('GitCheckpoints', () => {
  it('detects a repo', async () => {
    expect(await git.isRepo()).toBe(true)
  })

  it('creates a shadow commit without moving HEAD or touching the index', async () => {
    const headBefore = (await shell.run('git rev-parse HEAD', { cwd: dir })).stdout.trim()
    const ckpt = await git.create('before task')
    expect(ckpt).not.toBeNull()
    const headAfter = (await shell.run('git rev-parse HEAD', { cwd: dir })).stdout.trim()
    expect(headAfter).toBe(headBefore) // branch/HEAD untouched
    const status = (await shell.run('git status --porcelain', { cwd: dir })).stdout.trim()
    expect(status).toBe('') // index/worktree untouched
    expect((await git.list()).length).toBe(1)
  })

  it('rolls back agent changes: modified files restored, created files removed', async () => {
    const ckpt = await git.create('before task')
    // Simulate the agent making a mess.
    writeFileSync(join(dir, 'a.txt'), 'CORRUPTED\n')
    writeFileSync(join(dir, 'new.txt'), 'junk\n')

    await git.rollback(ckpt!.commit)

    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('original\n')
    expect(existsSync(join(dir, 'new.txt'))).toBe(false)
    const status = (await shell.run('git status --porcelain', { cwd: dir })).stdout.trim()
    expect(status).toBe('') // clean
  })

  it('returns null for a non-git directory', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'vibeseek-plain-'))
    try {
      const g = new GitCheckpoints(plain, shell)
      expect(await g.isRepo()).toBe(false)
      expect(await g.create('x')).toBeNull()
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
})
