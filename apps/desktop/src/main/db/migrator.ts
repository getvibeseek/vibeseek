import { existsSync, copyFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/**
 * Minimal DB surface the migrator needs. better-sqlite3 is adapted to this in
 * database.ts; tests use a fake. Keeping better-sqlite3 out of this module means
 * the migration logic is unit-testable in plain Node (the native binary is built
 * for Electron's ABI and can't load under vitest).
 */
export interface MigrationDb {
  exec(sql: string): void
  /** Highest applied version, or 0 if none. */
  getMaxVersion(): number
  /** Run fn atomically (one transaction). */
  transaction(fn: () => void): void
}

export interface Migration {
  version: number
  up: (db: MigrationDb) => void
}

export interface MigratorHooks {
  backupDb: typeof backupDb
  restoreDb: typeof restoreDb
}

const KEEP_BACKUPS = 3
let backupSeq = 0

/** Copy the db file to a timestamped .bak and prune to the newest 3. */
export function backupDb(dbPath: string): string | null {
  if (!existsSync(dbPath)) return null
  // Counter suffix guarantees uniqueness even for two backups in the same ms.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const seq = String(backupSeq++).padStart(6, '0')
  const backup = `${dbPath}.bak.${stamp}-${seq}`
  copyFileSync(dbPath, backup)

  const base = basename(dbPath)
  const dir = dirname(dbPath)
  const backups = readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.bak.`))
    .sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - KEEP_BACKUPS))) {
    rmSync(join(dir, old), { force: true })
  }
  return backup
}

export function restoreDb(dbPath: string, backupPath: string): void {
  copyFileSync(backupPath, dbPath)
}

/**
 * Apply pending forward-only migrations. Backs up the db file before touching
 * it; if any migration throws, restores the backup and rethrows so a bad
 * migration never leaves a half-applied schema.
 */
export function runMigrations(
  db: MigrationDb,
  dbPath: string,
  migrations: Migration[],
  hooks: MigratorHooks = { backupDb, restoreDb }
): { applied: number[] } {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)'
  )
  const current = db.getMaxVersion()
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version)
  if (pending.length === 0) return { applied: [] }

  const backup = hooks.backupDb(dbPath)
  try {
    for (const m of pending) {
      db.transaction(() => {
        m.up(db)
        db.exec(
          `INSERT INTO schema_migrations (version, applied_at) VALUES (${m.version}, '${new Date().toISOString()}')`
        )
      })
    }
  } catch (err) {
    if (backup) hooks.restoreDb(dbPath, backup)
    throw err
  }
  return { applied: pending.map((m) => m.version) }
}
