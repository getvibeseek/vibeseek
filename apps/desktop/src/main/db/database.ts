import Database from 'better-sqlite3'
import { runMigrations, type MigrationDb } from './migrator'
import { MIGRATIONS } from './migrations'

export type Db = Database.Database

/**
 * Open (creating if missing) the SQLite database and bring its schema up to
 * date. The file is recreated automatically if deleted — better-sqlite3 creates
 * it on open and migrations rebuild the tables.
 */
export function openDatabase(dbPath: string): Db {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  const adapter: MigrationDb = {
    exec: (sql) => {
      db.exec(sql)
    },
    getMaxVersion: () => {
      const row = db
        .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
        .get() as { v: number }
      return row.v
    },
    transaction: (fn) => {
      db.transaction(fn)()
    },
  }

  runMigrations(adapter, dbPath, MIGRATIONS)
  return db
}
