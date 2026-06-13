import type { Migration } from './migrator'

/**
 * Forward-only schema migrations. Append new versions; never edit or remove an
 * applied one. usage_log columns: ts/session/model/hit/miss/output/
 * thinking/cost (created empty now; populated when metering lands in Stage 1).
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      )`)
      db.exec(`CREATE TABLE IF NOT EXISTS usage_log (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        ts       TEXT    NOT NULL,
        session  TEXT,
        model    TEXT    NOT NULL,
        hit      INTEGER NOT NULL DEFAULT 0,
        miss     INTEGER NOT NULL DEFAULT 0,
        output   INTEGER NOT NULL DEFAULT 0,
        thinking INTEGER NOT NULL DEFAULT 0,
        cost     REAL    NOT NULL DEFAULT 0
      )`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_usage_log_ts ON usage_log (ts)`)
    },
  },
  {
    // Conversation persistence: projects' sessions and their messages.
    version: 2,
    up: (db) => {
      db.exec(`CREATE TABLE IF NOT EXISTS sessions (
        id          TEXT PRIMARY KEY,
        project_dir TEXT NOT NULL,
        title       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )`)
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions (project_dir, updated_at)`
      )
      db.exec(`CREATE TABLE IF NOT EXISTS messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        idx        INTEGER NOT NULL,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        ts         TEXT NOT NULL
      )`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, idx)`)
    },
  },
]
