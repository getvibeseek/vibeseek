import type { Db } from './database'
import type { PersistedMessage, SessionMeta } from '../../shared/ipc'

interface SessionRow {
  id: string
  project_dir: string
  title: string
  created_at: string
  updated_at: string
}

/** One past-conversation hit from memory_search. */
export interface MemoryHit {
  sessionId: string
  title: string
  role: string
  ts: string
  snippet: string
}

/** Conversation persistence: sessions per project and their messages. */
export class SessionStore {
  private ftsReady = false
  private ftsOk = false

  constructor(private readonly db: Db) {}

  /** Lazily create the FTS5 index (trigram tokenizer → works for CJK + code).
   *  If this build of SQLite lacks FTS5, search degrades to "unavailable". */
  private ensureFts(): boolean {
    if (this.ftsReady) return this.ftsOk
    this.ftsReady = true
    try {
      this.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
         USING fts5(text, message_id UNINDEXED, tokenize='trigram')`
      )
      this.db.exec(`CREATE TABLE IF NOT EXISTS fts_state (k TEXT PRIMARY KEY, v INTEGER)`)
      this.ftsOk = true
    } catch {
      this.ftsOk = false
    }
    return this.ftsOk
  }

  /** Index any messages added since the last sync (append-only → cheap delta). */
  private syncFts(): void {
    const last =
      (
        this.db.prepare(`SELECT v FROM fts_state WHERE k = 'last_msg'`).get() as
          | { v: number }
          | undefined
      )?.v ?? 0
    const rows = this.db
      .prepare(`SELECT id, content FROM messages WHERE id > ? ORDER BY id`)
      .all(last) as Array<{ id: number; content: string }>
    if (rows.length === 0) return
    const ins = this.db.prepare(`INSERT INTO messages_fts (text, message_id) VALUES (?, ?)`)
    const mark = this.db.prepare(
      `INSERT INTO fts_state (k, v) VALUES ('last_msg', ?) ON CONFLICT(k) DO UPDATE SET v = ?`
    )
    this.db.transaction(() => {
      let maxId = last
      for (const r of rows) {
        let text = ''
        try {
          text = (JSON.parse(r.content) as { text?: string }).text ?? ''
        } catch {
          text = ''
        }
        if (text.trim()) ins.run(text, r.id)
        maxId = r.id
      }
      mark.run(maxId, maxId)
    })()
  }

  /** Full-text recall over a project's past conversations (memory_search). */
  searchMessages(projectDir: string, query: string, limit = 6): MemoryHit[] {
    if (!this.ensureFts()) return []
    // Each token quoted as a phrase (no FTS operator injection) and OR-ed for recall.
    const terms = query
      .replace(/["*()]/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
    if (terms.length === 0) return []
    const fts = terms.map((t) => `"${t}"`).join(' OR ')
    try {
      this.syncFts()
      const rows = this.db
        .prepare(
          `SELECT m.session_id AS sessionId, m.role AS role, m.ts AS ts, s.title AS title,
                  snippet(messages_fts, 0, '《', '》', '…', 14) AS snippet
           FROM messages_fts
           JOIN messages m ON m.id = messages_fts.message_id
           JOIN sessions s ON s.id = m.session_id
           WHERE messages_fts MATCH ? AND s.project_dir = ?
           ORDER BY bm25(messages_fts) LIMIT ?`
        )
        .all(fts, projectDir, limit) as MemoryHit[]
      return rows
    } catch {
      return []
    }
  }

  /** Search conversations across ALL projects by title or message content
   *  (the sidebar 搜索). Title matches first, then full-text message hits. */
  searchAllSessions(
    query: string,
    limit = 20
  ): Array<{ id: string; projectDir: string; title: string; snippet: string; updatedAt: string }> {
    const q = query.trim()
    if (q.length < 2) return []
    const out = new Map<
      string,
      { id: string; projectDir: string; title: string; snippet: string; updatedAt: string }
    >()
    // 1) Title matches (cheap LIKE, most relevant for "find that conversation").
    const titleRows = this.db
      .prepare(
        `SELECT id, project_dir AS projectDir, title, updated_at AS updatedAt
         FROM sessions WHERE title LIKE ? ORDER BY updated_at DESC LIMIT ?`
      )
      .all(`%${q}%`, limit) as Array<{
      id: string
      projectDir: string
      title: string
      updatedAt: string
    }>
    for (const r of titleRows) out.set(r.id, { ...r, snippet: '' })
    // 2) Full-text message hits (one best snippet per session).
    if (this.ensureFts()) {
      const terms = q
        .replace(/["*()]/g, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
      if (terms.length > 0) {
        const fts = terms.map((t) => `"${t}"`).join(' OR ')
        try {
          this.syncFts()
          const rows = this.db
            .prepare(
              `SELECT s.id AS id, s.project_dir AS projectDir, s.title AS title,
                      s.updated_at AS updatedAt,
                      snippet(messages_fts, 0, '《', '》', '…', 12) AS snippet
               FROM messages_fts
               JOIN messages m ON m.id = messages_fts.message_id
               JOIN sessions s ON s.id = m.session_id
               WHERE messages_fts MATCH ?
               ORDER BY bm25(messages_fts) LIMIT ?`
            )
            .all(fts, limit * 3) as Array<{
            id: string
            projectDir: string
            title: string
            updatedAt: string
            snippet: string
          }>
          for (const r of rows) {
            if (out.size >= limit && !out.has(r.id)) continue
            if (!out.has(r.id)) out.set(r.id, r)
          }
        } catch {
          // FTS unavailable — title matches still returned.
        }
      }
    }
    return [...out.values()].slice(0, limit)
  }

  create(id: string, projectDir: string, now: string): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_dir, title, created_at, updated_at)
         VALUES (?, ?, '', ?, ?)`
      )
      .run(id, projectDir, now, now)
  }

  list(projectDir: string): SessionMeta[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, updated_at FROM sessions
         WHERE project_dir = ? ORDER BY updated_at DESC`
      )
      .all(projectDir) as Array<{ id: string; title: string; updated_at: string }>
    return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }))
  }

  /** Total conversation count across every project (achievement-page stat). */
  countAll(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n
  }

  /** id → title map for every conversation (dashboard ranking labels). */
  titles(): Map<string, string> {
    const rows = this.db.prepare('SELECT id, title FROM sessions').all() as Array<{
      id: string
      title: string
    }>
    return new Map(rows.map((r) => [r.id, r.title]))
  }

  /** Stored message count across one project's conversations. */
  countMessagesOfProject(dir: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS n FROM messages m
           JOIN sessions s ON s.id = m.session_id WHERE s.project_dir = ?`
        )
        .get(dir) as { n: number }
    ).n
  }

  /** Stored message count since an ISO timestamp (''=all). */
  countMessagesSince(sinceIso = ''): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE ts >= ?').get(sinceIso) as {
        n: number
      }
    ).n
  }

  get(id: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined
  }

  messages(sessionId: string): PersistedMessage[] {
    const rows = this.db
      .prepare('SELECT id, content, ts FROM messages WHERE session_id = ? ORDER BY idx')
      .all(sessionId) as Array<{ id: number; content: string; ts: string }>
    // id + ts ride along from columns and are authoritative (older content JSON
    // predates these fields; any stale copy inside content is overridden here).
    return rows.map((r) => ({ ...(JSON.parse(r.content) as PersistedMessage), id: r.id, ts: r.ts }))
  }

  /** Delete a message and everything after it (rewind) — id is the DB anchor. */
  truncateFrom(sessionId: string, messageId: number, now: string): void {
    this.db
      .prepare('DELETE FROM messages WHERE session_id = ? AND id >= ?')
      .run(sessionId, messageId)
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
  }

  private nextIdx(sessionId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(idx), -1) AS m FROM messages WHERE session_id = ?')
      .get(sessionId) as { m: number }
    return row.m + 1
  }

  /** Insert a message; returns its row id (the rewind/fork anchor). */
  append(sessionId: string, msg: PersistedMessage, now: string): number {
    const idx = this.nextIdx(sessionId)
    const info = this.db
      .prepare('INSERT INTO messages (session_id, idx, role, content, ts) VALUES (?, ?, ?, ?, ?)')
      .run(sessionId, idx, msg.role, JSON.stringify(msg), now)
    this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
    return Number(info.lastInsertRowid)
  }

  /**
   * Attach the pre-task git shadow commit to an already-persisted user turn.
   * The turn is persisted FIRST (so a fast session-switch still sees it) and
   * the checkpoint — whose `git add -A` can take seconds — lands afterwards.
   */
  setMessageCheckpoint(messageId: number, commit: string): void {
    const row = this.db.prepare('SELECT content FROM messages WHERE id = ?').get(messageId) as
      | { content: string }
      | undefined
    if (!row) return
    const msg = JSON.parse(row.content) as PersistedMessage
    msg.checkpoint = commit
    this.db
      .prepare('UPDATE messages SET content = ? WHERE id = ?')
      .run(JSON.stringify(msg), messageId)
  }

  setTitle(id: string, title: string, now: string): void {
    this.db
      .prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, now, id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
  }
}
