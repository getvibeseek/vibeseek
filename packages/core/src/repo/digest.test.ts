import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRepoDigest } from './digest'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vibeseek-digest-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const write = (rel: string, content: string): void => {
  const full = join(dir, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content, 'utf8')
}

describe('buildRepoDigest', () => {
  it('ingests source files, skips deps/binaries, and is deterministic', () => {
    write('src/a.ts', 'export const a = 1')
    write('src/b.ts', 'export const b = 2')
    write('node_modules/dep/index.js', 'junk')
    write('logo.png', 'PNGDATA')
    const d1 = buildRepoDigest(dir)
    const d2 = buildRepoDigest(dir)
    expect(d1.fileCount).toBe(2)
    expect(d1.text).toContain('=== src/a.ts ===')
    expect(d1.text).toContain('export const b = 2')
    expect(d1.text).not.toContain('junk')
    expect(d1.text).not.toContain('PNGDATA')
    expect(d1.text).toBe(d2.text) // stable across runs
    expect(d1.tokenEstimate).toBeGreaterThan(0)
  })

  it('truncates when over the token budget', () => {
    write('big.ts', 'x'.repeat(9000))
    // 9000 chars ≈ 3000 tokens; budget of 1000 tokens (3000 chars) must truncate.
    const d = buildRepoDigest(dir, { maxTokens: 1000 })
    expect(d.truncated).toBe(true)
  })
})
