import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  INSERT_USAGE,
  SELECT_TOTALS,
  SELECT_DAILY,
  SELECT_SESSION_BY_MODEL,
  SELECT_PROJECT_BY_MODEL,
  SELECT_DAILY_BY_MODEL,
  SELECT_SESSIONS_RANGE,
  SELECT_REQUESTS_OF_SESSION,
} from './usage-store'

// Validates the production SQL strings against an in-memory SQLite (node:sqlite),
// since better-sqlite3 is built for Electron's ABI and can't load under vitest.
// The statement shapes (named @params, .run/.get) match better-sqlite3.
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL, session TEXT, model TEXT NOT NULL,
    hit INTEGER NOT NULL DEFAULT 0, miss INTEGER NOT NULL DEFAULT 0,
    output INTEGER NOT NULL DEFAULT 0, thinking INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0
  )`)
  return db
}

describe('usage_log SQL', () => {
  it('inserts rows and aggregates totals', () => {
    const db = freshDb()
    const ins = db.prepare(INSERT_USAGE)
    ins.run({
      ts: '2026-06-12',
      session: 'main',
      model: 'flash',
      hit: 90,
      miss: 10,
      output: 5,
      thinking: 2,
      cost: 0.001,
    })
    ins.run({
      ts: '2026-06-12',
      session: 'main',
      model: 'flash',
      hit: 95,
      miss: 5,
      output: 3,
      thinking: 1,
      cost: 0.0008,
    })

    const t = db.prepare(SELECT_TOTALS).get() as Record<string, number>
    expect(t.requests).toBe(2)
    expect(t.hit).toBe(185)
    expect(t.miss).toBe(15)
    expect(t.output).toBe(8)
    expect(t.cost).toBeCloseTo(0.0018)
    db.close()
  })

  it('totals are zero on an empty table', () => {
    const db = freshDb()
    const t = db.prepare(SELECT_TOTALS).get() as Record<string, number>
    expect(t.requests).toBe(0)
    expect(t.hit).toBe(0)
    expect(t.cost).toBe(0)
    db.close()
  })

  it('groups requests per UTC day, oldest first, filtered by @since', () => {
    const db = freshDb()
    const ins = db.prepare(INSERT_USAGE)
    const base = {
      session: 'main',
      model: 'flash',
      hit: 1,
      miss: 1,
      output: 1,
      thinking: 0,
      cost: 0,
    }
    // Two rows on the 10th, one on the 11th, one on the 9th (excluded by @since).
    ins.run({ ...base, ts: '2026-06-09T08:00:00.000Z' })
    ins.run({ ...base, ts: '2026-06-10T08:00:00.000Z' })
    ins.run({ ...base, ts: '2026-06-10T20:00:00.000Z' })
    ins.run({ ...base, ts: '2026-06-11T01:00:00.000Z' })

    const days = db.prepare(SELECT_DAILY).all({ since: '2026-06-10' }) as Array<{
      day: string
      requests: number
    }>
    expect(days).toEqual([
      { day: '2026-06-10', requests: 2 },
      { day: '2026-06-11', requests: 1 },
    ])
    db.close()
  })

  it('aggregates per session and per project (join over sessions)', () => {
    const db = freshDb()
    db.exec(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY, project_dir TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`)
    db.exec(`INSERT INTO sessions VALUES
      ('s1','D:/projA','','2026','2026'), ('s2','D:/projA','','2026','2026'),
      ('s3','D:/projB','','2026','2026')`)
    const ins = db.prepare(INSERT_USAGE)
    const row = {
      ts: '2026-06-12',
      model: 'flash',
      hit: 100,
      miss: 10,
      output: 5,
      thinking: 1,
      cost: 0.5,
    }
    ins.run({ ...row, session: 's1' })
    ins.run({ ...row, session: 's2' })
    ins.run({ ...row, session: 's3' })

    const bySession = db.prepare(SELECT_SESSION_BY_MODEL).all({ session: 's1' }) as Array<
      Record<string, number>
    >
    expect(bySession).toHaveLength(1)
    expect(bySession[0].hit).toBe(100)
    expect(bySession[0].requests).toBe(1)
    expect(bySession[0].thinking).toBe(1)

    const byProject = db.prepare(SELECT_PROJECT_BY_MODEL).all({ dir: 'D:/projA' }) as Array<
      Record<string, number>
    >
    expect(byProject).toHaveLength(1)
    expect(byProject[0].hit).toBe(200) // s1 + s2, not s3
    expect(byProject[0].requests).toBe(2)
    expect(byProject[0].cost).toBeCloseTo(1.0)
    db.close()
  })

  it('daily-by-model, session-range ranking, and per-request rows', () => {
    const db = freshDb()
    const ins = db.prepare(INSERT_USAGE)
    const mk = (ts: string, session: string, model: string, hit: number): void => {
      void ins.run({ ts, session, model, hit, miss: 10, output: 5, thinking: 0, cost: 0.1 })
    }
    mk('2026-06-10T08:00:00Z', 'a', 'flash', 100)
    mk('2026-06-10T09:00:00Z', 'a', 'pro', 50)
    mk('2026-06-11T08:00:00Z', 'b', 'flash', 200)

    const daily = db.prepare(SELECT_DAILY_BY_MODEL).all({ since: '' }) as Array<
      Record<string, string | number>
    >
    expect(daily).toHaveLength(3) // (10th flash, 10th pro, 11th flash)
    expect(daily[0].day).toBe('2026-06-10')

    const range = db.prepare(SELECT_SESSIONS_RANGE).all({ since: '2026-06-11' }) as Array<
      Record<string, string | number>
    >
    expect(range).toHaveLength(1) // only session b is in range
    expect(range[0].session).toBe('b')

    const reqs = db.prepare(SELECT_REQUESTS_OF_SESSION).all({ session: 'a' }) as Array<
      Record<string, number>
    >
    expect(reqs).toHaveLength(2)
    expect(reqs[0].hit).toBe(100) // ordered by insertion
    db.close()
  })
})
