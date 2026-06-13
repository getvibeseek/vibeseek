import type { DiffRow } from '../../shared/ipc'

interface Op {
  type: 'ctx' | 'add' | 'del'
  text: string
}

/**
 * Line ops via LCS, with common prefix/suffix trimmed first so the quadratic
 * DP only sees the changed middle (typical edits → tiny). A pathological
 * middle (>4M cells) falls back to whole-block replace rather than stalling.
 */
function diffOps(before: string, after: string): Op[] {
  const a = before.length ? before.split('\n') : []
  const b = after.length ? after.split('\n') : []
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const am = a.slice(p, a.length - s)
  const bm = b.slice(p, b.length - s)

  const mid: Op[] = []
  if (am.length * bm.length > 4_000_000) {
    for (const text of am) mid.push({ type: 'del', text })
    for (const text of bm) mid.push({ type: 'add', text })
  } else {
    const m = am.length
    const n = bm.length
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < m && j < n) {
      if (am[i] === bm[j]) {
        mid.push({ type: 'ctx', text: am[i] })
        i++
        j++
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        mid.push({ type: 'del', text: am[i++] })
      } else {
        mid.push({ type: 'add', text: bm[j++] })
      }
    }
    while (i < m) mid.push({ type: 'del', text: am[i++] })
    while (j < n) mid.push({ type: 'add', text: bm[j++] })
  }

  return [
    ...a.slice(0, p).map((text) => ({ type: 'ctx' as const, text })),
    ...mid,
    ...a.slice(a.length - s).map((text) => ({ type: 'ctx' as const, text })),
  ]
}

/** Line-level diff via LCS. Returns added/removed counts for the change badge. */
export function lineDiffCounts(before: string, after: string): { added: number; removed: number } {
  const ops = diffOps(before, after)
  return {
    added: ops.filter((o) => o.type === 'add').length,
    removed: ops.filter((o) => o.type === 'del').length,
  }
}

/**
 * Unified-diff rows for the Changes panel: changed lines with `context` lines
 * around them; longer unchanged runs collapse into one 'gap' row. Both old and
 * new line numbers ride along for the gutter.
 */
export function diffRows(before: string, after: string, context = 3): DiffRow[] {
  const ops = diffOps(before, after)
  let oldNo = 1
  let newNo = 1
  // Hunk = a maximal run of consecutive changed ops. The SAME definition is
  // used by withHunkRejected/Accepted below, so UI indices match the tracker.
  let hunk = -1
  let inHunk = false
  const numbered: DiffRow[] = ops.map((op) => {
    const row: DiffRow = { type: op.type, text: op.text }
    if (op.type !== 'add') row.oldNo = oldNo++
    if (op.type !== 'del') row.newNo = newNo++
    if (op.type === 'ctx') {
      inHunk = false
    } else {
      if (!inHunk) {
        hunk++
        inHunk = true
      }
      row.hunk = hunk
    }
    return row
  })

  const keep = new Array<boolean>(numbered.length).fill(false)
  numbered.forEach((r, idx) => {
    if (r.type === 'ctx') return
    const from = Math.max(0, idx - context)
    const to = Math.min(numbered.length - 1, idx + context)
    for (let k = from; k <= to; k++) keep[k] = true
  })

  const out: DiffRow[] = []
  let gapOpen = false
  numbered.forEach((r, idx) => {
    if (r.type !== 'ctx' || keep[idx]) {
      out.push(r)
      gapOpen = false
    } else if (!gapOpen) {
      out.push({ type: 'gap', text: '' })
      gapOpen = true
    }
  })
  return out
}

/** Per-op hunk index (same maximal-changed-run definition as diffRows). */
function opHunks(ops: Op[]): number[] {
  const idx = new Array<number>(ops.length).fill(-1)
  let hunk = -1
  let inHunk = false
  ops.forEach((op, i) => {
    if (op.type === 'ctx') {
      inHunk = false
    } else {
      if (!inHunk) {
        hunk++
        inHunk = true
      }
      idx[i] = hunk
    }
  })
  return idx
}

/**
 * The CURRENT content with hunk `index` reverted to its original lines —
 * every other change stays (hunk-level reject). null = no such hunk.
 */
export function withHunkRejected(before: string, after: string, index: number): string | null {
  const ops = diffOps(before, after)
  const hunks = opHunks(ops)
  if (!hunks.includes(index)) return null
  const lines: string[] = []
  ops.forEach((op, i) => {
    if (hunks[i] === index) {
      if (op.type === 'del') lines.push(op.text) // restore the original side
    } else if (op.type !== 'del') {
      lines.push(op.text) // keep the current side everywhere else
    }
  })
  return lines.join('\n')
}

/**
 * The ORIGINAL baseline with hunk `index` adopted into it (hunk-level
 * accept): that hunk leaves the diff for good; the disk stays untouched.
 */
export function withHunkAccepted(before: string, after: string, index: number): string | null {
  const ops = diffOps(before, after)
  const hunks = opHunks(ops)
  if (!hunks.includes(index)) return null
  const lines: string[] = []
  ops.forEach((op, i) => {
    if (hunks[i] === index) {
      if (op.type === 'add') lines.push(op.text) // adopt the new side
    } else if (op.type !== 'add') {
      lines.push(op.text) // keep the original side everywhere else
    }
  })
  return lines.join('\n')
}
