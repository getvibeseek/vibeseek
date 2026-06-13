import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { backupDb, runMigrations, type MigrationDb, type Migration } from './migrator'

let dir: string
let dbPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vibeseek-db-'))
  dbPath = join(dir, 'vibeseek.db')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** In-memory MigrationDb that records exec'd SQL and applied versions. */
class FakeDb implements MigrationDb {
  execs: string[] = []
  versions: number[] = []
  exec(sql: string): void {
    this.execs.push(sql)
    const m = sql.match(/INSERT INTO schema_migrations \(version, applied_at\) VALUES \((\d+)/)
    if (m) this.versions.push(Number(m[1]))
  }
  getMaxVersion(): number {
    return this.versions.length ? Math.max(...this.versions) : 0
  }
  transaction(fn: () => void): void {
    const snapshot = [...this.versions]
    try {
      fn()
    } catch (err) {
      this.versions = snapshot // roll back on failure
      throw err
    }
  }
}

describe('runMigrations', () => {
  it('applies pending migrations and records versions', () => {
    const db = new FakeDb()
    const migrations: Migration[] = [
      { version: 1, up: (d) => d.exec('CREATE TABLE settings (k)') },
      { version: 2, up: (d) => d.exec('CREATE TABLE usage_log (id)') },
    ]
    const result = runMigrations(db, dbPath, migrations)
    expect(result.applied).toEqual([1, 2])
    expect(db.execs.join('\n')).toContain('CREATE TABLE settings')
    expect(db.execs.join('\n')).toContain('CREATE TABLE usage_log')
  })

  it('is idempotent — skips already-applied versions', () => {
    const db = new FakeDb()
    const migrations: Migration[] = [{ version: 1, up: (d) => d.exec('CREATE TABLE a (x)') }]
    runMigrations(db, dbPath, migrations)
    const second = runMigrations(db, dbPath, migrations)
    expect(second.applied).toEqual([])
  })

  it('restores the db file when a migration throws', () => {
    writeFileSync(dbPath, 'ORIGINAL')
    const db = new FakeDb()
    const migrations: Migration[] = [
      // v1 mutates the file (simulating a partial write)…
      { version: 1, up: () => writeFileSync(dbPath, 'MODIFIED') },
      // …then v2 fails, which must trigger a restore to ORIGINAL.
      {
        version: 2,
        up: () => {
          throw new Error('bad migration')
        },
      },
    ]
    expect(() => runMigrations(db, dbPath, migrations)).toThrow('bad migration')
    expect(readFileSync(dbPath, 'utf8')).toBe('ORIGINAL')
  })
})

describe('backupDb', () => {
  it('returns null when there is no db file yet', () => {
    expect(backupDb(dbPath)).toBeNull()
  })

  it('creates a backup and keeps at most 3', () => {
    writeFileSync(dbPath, 'data')
    for (let i = 0; i < 5; i++) backupDb(dbPath)
    const backups = readdirSync(dir).filter((f) => f.includes('.bak.'))
    expect(backups.length).toBe(3)
    expect(existsSync(dbPath)).toBe(true)
  })
})
