import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ToolRegistry } from './registry'
import { applyEdit } from './edit'
import { createShell } from '../platform/shell'
import type { ToolContext } from './types'

let dir: string
let ctx: ToolContext

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vibeseek-tools-'))
  ctx = { cwd: dir, shell: createShell() }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const reg = new ToolRegistry()

describe('read_file', () => {
  it('returns numbered lines and not-found errors', async () => {
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree')
    const r = await reg.execute('read_file', { path: 'a.txt' }, ctx)
    expect(r.content).toContain('    1\tone')
    expect(r.content).toContain('    3\tthree')
    const missing = await reg.execute('read_file', { path: 'nope.txt' }, ctx)
    expect(missing.isError).toBe(true)
  })

  it('paginates with offset/limit', async () => {
    writeFileSync(join(dir, 'big.txt'), Array.from({ length: 10 }, (_, i) => `L${i}`).join('\n'))
    const r = await reg.execute('read_file', { path: 'big.txt', offset: 5, limit: 2 }, ctx)
    expect(r.content).toContain('    6\tL5')
    expect(r.meta?.truncated).toBe(true)
  })
})

describe('write_file', () => {
  it('writes and creates parent dirs', async () => {
    const r = await reg.execute('write_file', { path: 'nested/x.txt', content: 'hi' }, ctx)
    expect(r.isError).toBeFalsy()
    expect(readFileSync(join(dir, 'nested/x.txt'), 'utf8')).toBe('hi')
  })

  it('rejects paths escaping the project root', async () => {
    const r = await reg.execute('write_file', { path: '../evil.txt', content: 'x' }, ctx)
    expect(r.isError).toBe(true)
  })
})

describe('glob & grep', () => {
  beforeEach(() => {
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const foo = 1')
    writeFileSync(join(dir, 'src', 'b.ts'), 'export const bar = 2')
    writeFileSync(join(dir, 'readme.md'), 'foo here')
  })
  it('glob matches by pattern', async () => {
    const r = await reg.execute('glob', { pattern: 'src/**/*.ts' }, ctx)
    expect(r.content.split('\n').sort()).toEqual(['src/a.ts', 'src/b.ts'])
  })
  it('grep finds matches with line numbers and glob filter', async () => {
    const r = await reg.execute('grep', { pattern: 'foo', glob: '*.ts' }, ctx)
    expect(r.content).toContain('src/a.ts:1:')
    expect(r.content).not.toContain('readme.md')
  })
})

describe('applyEdit degradation', () => {
  it('level 1: exact unique match', () => {
    const out = applyEdit('a\nb\nc', 'b', 'B')
    expect(out.level).toBe('exact')
    expect(out.newContent).toBe('a\nB\nc')
  })
  it('level 1 fails on ambiguous (multiple) matches', () => {
    const out = applyEdit('x\nx\n', 'x', 'y')
    expect(out.level).toBe('failed')
  })
  it('level 2: whitespace-tolerant match', () => {
    // File is indented; old_str is not — no exact substring, but line-normalized matches.
    const file = 'function a() {\n        return 1\n}\n'
    const out = applyEdit(
      file,
      'function a() {\nreturn 1\n}',
      'function a() {\n        return 2\n}'
    )
    expect(out.level).toBe('tolerant')
    expect(out.newContent).toContain('return 2')
  })
  it('level 3: failed with rewrite suggestion for small files', async () => {
    writeFileSync(join(dir, 'f.ts'), 'const a = 1\n')
    const r = await reg.execute(
      'edit_file',
      { path: 'f.ts', old_str: 'NONEXISTENT', new_str: 'x' },
      ctx
    )
    expect(r.isError).toBe(true)
    expect(r.meta?.matchLevel).toBe('failed')
    expect(r.meta?.suggestRewrite).toBe(true)
  })
  it('edit_file records the match level on success', async () => {
    writeFileSync(join(dir, 'f.ts'), 'const a = 1\n')
    const r = await reg.execute(
      'edit_file',
      { path: 'f.ts', old_str: 'const a = 1', new_str: 'const a = 2' },
      ctx
    )
    expect(r.meta?.matchLevel).toBe('exact')
    expect(readFileSync(join(dir, 'f.ts'), 'utf8')).toContain('const a = 2')
  })
})

describe('shell', () => {
  it('runs a command and returns exit code, UTF-8 intact', async () => {
    const r = await reg.execute('shell', { command: 'echo 中文ok' }, ctx)
    expect(r.content).toContain('exit code: 0')
    expect(r.content).toContain('中文ok')
  })
})
