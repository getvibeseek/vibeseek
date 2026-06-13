import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ChangeTracker } from './change-tracker'

// User-reported: the model passes ABSOLUTE paths as often as relative ones.
// Tools resolve both fine, but the tracker used to join(cwd, absolute) into a
// garbage path — every entry read as null===null and the panel showed 变更 0.
describe('ChangeTracker path normalization', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibeseek-ct-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('tracks a NEW file created via an absolute path', () => {
    const t = new ChangeTracker(dir)
    const abs = join(dir, 'server.py')
    t.snapshot(abs) // pre-write: file does not exist
    writeFileSync(abs, 'print("hi")\n')
    const list = t.list()
    expect(list).toHaveLength(1)
    expect(list[0].path).toBe('server.py')
    expect(list[0].status).toBe('created')
  })

  it('absolute and relative refs to the same file fold into one entry', () => {
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'one\n')
    const t = new ChangeTracker(dir)
    t.snapshot(file) // absolute first
    t.snapshot('a.txt') // relative second — must be the same entry
    writeFileSync(file, 'two\n')
    expect(t.list()).toHaveLength(1)
    // Both path forms resolve to the same snapshot ('one' shows as removed).
    const delTexts = (p: string): string[] =>
      t
        .diff(p)
        .rows.filter((r) => r.type === 'del')
        .map((r) => r.text)
    expect(delTexts('a.txt')).toContain('one')
    expect(delTexts(file)).toContain('one')
  })

  it('reject restores via absolute-path entry (created file gets deleted)', () => {
    const t = new ChangeTracker(dir)
    const abs = join(dir, 'new.md')
    t.snapshot(abs)
    writeFileSync(abs, 'draft\n')
    t.reject(abs)
    expect(existsSync(abs)).toBe(false)
    // misclick insurance
    t.undoReject()
    expect(readFileSync(abs, 'utf8')).toBe('draft\n')
  })

  it('hunk reject reverts one change, keeps the other, and is undoable', () => {
    const file = join(dir, 'multi.txt')
    writeFileSync(file, 'a\nb\nc\nd\ne')
    const t = new ChangeTracker(dir)
    t.snapshot('multi.txt')
    writeFileSync(file, 'a\nB\nc\nD\ne') // two hunks
    t.rejectHunk('multi.txt', 0)
    expect(readFileSync(file, 'utf8')).toBe('a\nb\nc\nD\ne')
    expect(t.list()).toHaveLength(1) // hunk 1 still differs
    t.undoReject()
    expect(readFileSync(file, 'utf8')).toBe('a\nB\nc\nD\ne')
  })

  it('hunk accept folds into baseline; last hunk accept clears the entry', () => {
    const file = join(dir, 'fold.txt')
    writeFileSync(file, 'a\nb\nc\nd\ne')
    const t = new ChangeTracker(dir)
    t.snapshot('fold.txt')
    writeFileSync(file, 'a\nB\nc\nD\ne')
    t.acceptHunk('fold.txt', 0)
    expect(readFileSync(file, 'utf8')).toBe('a\nB\nc\nD\ne') // disk untouched
    const rows = t.diff('fold.txt').rows.filter((r) => r.hunk !== undefined)
    expect(rows.map((r) => r.text)).toEqual(['d', 'D']) // only hunk 1 left
    t.acceptHunk('fold.txt', 0) // the remaining hunk (re-indexed to 0)
    expect(t.list()).toHaveLength(0)
  })

  it('old ledger with raw absolute keys revives after normalize-on-load', () => {
    const file = join(dir, 'index.html')
    writeFileSync(file, '<new/>\n')
    const ledger = join(dir, 'ledger.json')
    // What a pre-fix ledger looks like: absolute key, original captured as null
    // (snapshot read the garbage joined path and saw "missing").
    writeFileSync(ledger, JSON.stringify({ originals: [[file, null]], accepted: [] }))
    const t = new ChangeTracker(dir, ledger)
    const list = t.list()
    expect(list).toHaveLength(1)
    expect(list[0].path).toBe('index.html')
    expect(list[0].status).toBe('created')
  })
})
