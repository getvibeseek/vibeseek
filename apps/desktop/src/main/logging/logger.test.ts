import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Logger } from './logger'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vibeseek-logs-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function readChannel(prefix: string): string {
  const file = readdirSync(dir).find((f) => f.startsWith(prefix))
  return file ? readFileSync(join(dir, file), 'utf8') : ''
}

describe('Logger', () => {
  it('writes app log lines', () => {
    const log = new Logger(dir)
    log.appError('something broke')
    expect(readChannel('app-')).toContain('[ERROR] something broke')
  })

  it('redacts API keys in messages and meta — grep finds no sk-', () => {
    const log = new Logger(dir)
    log.appInfo('calling with sk-abc123def456ghi', { apiKey: 'sk-zzz999888777' })
    log.api({ model: 'flash', headers: { Authorization: 'Bearer sk-secrettoken123' } })
    const all = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n')
    expect(all).not.toMatch(/sk-(?!\*)/) // no sk- followed by a real char
    expect(all).toContain('sk-***')
  })

  it('writes api channel as jsonl', () => {
    const log = new Logger(dir)
    log.api({ model: 'flash', hit: 100, miss: 5 })
    const line = readChannel('api-').trim()
    const parsed = JSON.parse(line)
    expect(parsed.model).toBe('flash')
    expect(parsed.ts).toBeTruthy()
  })

  it('deletes log files older than 7 days on init', () => {
    const stale = join(dir, 'app-2000-01-01.log')
    writeFileSync(stale, 'old\n')
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    utimesSync(stale, old, old)
    new Logger(dir) // sweep runs in constructor
    expect(readdirSync(dir)).not.toContain('app-2000-01-01.log')
  })
})
