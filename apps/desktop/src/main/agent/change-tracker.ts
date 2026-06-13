import { readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import type { FileChange, FileDiff } from '../../shared/ipc'
import { lineDiffCounts, diffRows, withHunkRejected, withHunkAccepted } from './diff'

/**
 * Tracks files touched during a SESSION so the Changes panel can show diffs and
 * the user can accept (keep) or reject (restore the pre-task content) each file.
 * Snapshots the original content the first time a path is written.
 *
 * Persisted per session (会话总账): the original-content map is written to
 * a JSON ledger so the panel survives session switches and app restarts — the
 * "before" comes from the ledger, the "after" is always read live from disk.
 */
export class ChangeTracker {
  // relPath -> original content, or null if the file did not exist before.
  private readonly originals = new Map<string, string | null>()
  private readonly accepted = new Set<string>()

  constructor(
    private readonly cwd: string,
    /** Optional JSON ledger path; when given, state is loaded and saved there. */
    private readonly ledgerPath?: string
  ) {
    this.load()
  }

  private load(): void {
    if (!this.ledgerPath || !existsSync(this.ledgerPath)) return
    try {
      const data = JSON.parse(readFileSync(this.ledgerPath, 'utf8')) as {
        originals: Array<[string, string | null]>
        accepted: string[]
      }
      // Normalize on load too: ledgers written before the absolute-path fix
      // hold raw absolute keys — folding them here revives those entries.
      for (const [p, c] of data.originals) this.originals.set(this.normalize(p), c)
      for (const p of data.accepted) this.accepted.add(this.normalize(p))
    } catch {
      // A corrupt ledger just starts the session's change history fresh.
    }
  }

  private save(): void {
    if (!this.ledgerPath) return
    writeFileSync(
      this.ledgerPath,
      JSON.stringify({ originals: [...this.originals], accepted: [...this.accepted] }),
      'utf8'
    )
  }

  /** The model may pass paths relative OR absolute (it does both) — store one
   *  canonical form, or the same file shows twice and absolute entries resolve
   *  to garbage when joined onto cwd (user-reported: 变更恒为 0). */
  private normalize(p: string): string {
    if (!isAbsolute(p)) return p
    const rel = relative(this.cwd, p)
    // Outside the project (or another drive): keep the absolute path.
    return rel.startsWith('..') || isAbsolute(rel) ? p : rel
  }

  private absOf(relPath: string): string {
    return isAbsolute(relPath) ? relPath : join(this.cwd, relPath)
  }

  /** Capture the pre-write state of a path (once). */
  snapshot(path: string): void {
    const relPath = this.normalize(path)
    if (this.originals.has(relPath)) return
    const abs = this.absOf(relPath)
    this.originals.set(relPath, existsSync(abs) ? readFileSync(abs, 'utf8') : null)
    this.save()
  }

  private current(relPath: string): string | null {
    const abs = this.absOf(relPath)
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null
  }

  /** Files whose content actually differs from their snapshot. */
  list(): FileChange[] {
    const out: FileChange[] = []
    for (const [path, original] of this.originals) {
      const now = this.current(path)
      if (now === original) continue
      const { added, removed } = lineDiffCounts(original ?? '', now ?? '')
      out.push({
        path,
        status: original === null ? 'created' : 'modified',
        added,
        removed,
        accepted: this.accepted.has(path),
      })
    }
    return out
  }

  diff(path: string): FileDiff {
    const relPath = this.normalize(path)
    return {
      path: relPath,
      rows: diffRows(this.originals.get(relPath) ?? '', this.current(relPath) ?? ''),
    }
  }

  // One-level undo for the last reject (path + both sides of the decision).
  private lastReject: { path: string; original: string | null; discarded: string | null } | null =
    null

  /** Accept = adopt the current content as the new baseline: the entry leaves
   *  the review list for good (visible feedback, unlike the old silent flag). */
  accept(path: string): void {
    const relPath = this.normalize(path)
    this.originals.delete(relPath)
    this.accepted.delete(relPath)
    this.save()
  }

  /** Restore a file to its pre-task content (delete it if it didn't exist).
   *  Reversible once via undoReject (misclick insurance). */
  reject(path: string): void {
    const relPath = this.normalize(path)
    const original = this.originals.get(relPath)
    if (original === undefined) return
    const abs = this.absOf(relPath)
    this.lastReject = { path: relPath, original, discarded: this.current(relPath) }
    if (original === null) rmSync(abs, { force: true })
    else writeFileSync(abs, original, 'utf8')
    this.originals.delete(relPath)
    this.accepted.delete(relPath)
    this.save()
  }

  /** Revert ONE hunk to its original lines; other changes stay.
   *  Reversible via the same one-slot undoReject (full pre-state captured). */
  rejectHunk(path: string, hunk: number): void {
    const relPath = this.normalize(path)
    const original = this.originals.get(relPath)
    if (original === undefined) return
    const current = this.current(relPath)
    const next = withHunkRejected(original ?? '', current ?? '', hunk)
    if (next === null) return
    const abs = this.absOf(relPath)
    this.lastReject = { path: relPath, original, discarded: current }
    // A created file whose only hunk was rejected goes back to non-existence.
    if (original === null && next === '') {
      rmSync(abs, { force: true })
      this.originals.delete(relPath)
      this.accepted.delete(relPath)
    } else {
      writeFileSync(abs, next, 'utf8')
    }
    this.save()
  }

  /** Adopt ONE hunk into the baseline: it leaves the diff, disk untouched. */
  acceptHunk(path: string, hunk: number): void {
    const relPath = this.normalize(path)
    const original = this.originals.get(relPath)
    if (original === undefined) return
    const current = this.current(relPath)
    const next = withHunkAccepted(original ?? '', current ?? '', hunk)
    if (next === null) return
    if (next === current) {
      // Last hunk adopted — the whole file matches its baseline now.
      this.accept(relPath)
      return
    }
    this.originals.set(relPath, next)
    this.save()
  }

  /** The most recent reject that can still be undone, if any. */
  rejectedPath(): string | null {
    return this.lastReject?.path ?? null
  }

  /** Undo the last reject: write the discarded content back and re-track it. */
  undoReject(): void {
    if (!this.lastReject) return
    const { path, original, discarded } = this.lastReject
    const abs = this.absOf(path)
    if (discarded === null) rmSync(abs, { force: true })
    else writeFileSync(abs, discarded, 'utf8')
    this.originals.set(path, original)
    this.lastReject = null
    this.save()
  }

  /** Clear all tracking for this session (used after a full rollback). */
  reset(): void {
    this.originals.clear()
    this.accepted.clear()
    if (this.ledgerPath) rmSync(this.ledgerPath, { force: true })
  }
}
