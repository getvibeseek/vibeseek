import { describe, it, expect } from 'vitest'
import { lineDiffCounts, diffRows, withHunkRejected, withHunkAccepted } from './diff'

describe('lineDiffCounts', () => {
  it('counts a one-line replacement as 1 add + 1 del', () => {
    expect(lineDiffCounts('a\nb\nc', 'a\nX\nc')).toEqual({ added: 1, removed: 1 })
  })
  it('counts a created file as all-added', () => {
    expect(lineDiffCounts('', 'a\nb')).toEqual({ added: 2, removed: 0 })
  })
})

describe('diffRows', () => {
  it('keeps context around the change and collapses the far middle', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
    const after = before.replace('line10', 'CHANGED')
    const rows = diffRows(before, after, 2)
    // Far-from-change runs collapse: leading gap, context, del+add, context, trailing gap.
    expect(rows[0].type).toBe('gap')
    expect(rows[rows.length - 1].type).toBe('gap')
    const del = rows.find((r) => r.type === 'del')
    const add = rows.find((r) => r.type === 'add')
    expect(del?.text).toBe('line10')
    expect(del?.oldNo).toBe(11)
    expect(del?.newNo).toBeUndefined()
    expect(add?.text).toBe('CHANGED')
    expect(add?.newNo).toBe(11)
    const ctx = rows.filter((r) => r.type === 'ctx')
    expect(ctx).toHaveLength(4) // 2 above + 2 below
  })

  it('renders interleaved del/add at the change point, not two big blocks', () => {
    const rows = diffRows('keep\nold1\nold2\nkeep2', 'keep\nnew1\nkeep2')
    const types = rows.map((r) => r.type)
    expect(types).toEqual(['ctx', 'del', 'del', 'add', 'ctx'])
  })
})

describe('hunk operations', () => {
  // Two separate changes: line b→B (hunk 0) and line d→D (hunk 1).
  const before = 'a\nb\nc\nd\ne'
  const after = 'a\nB\nc\nD\ne'

  it('numbers hunks consistently in diffRows', () => {
    const rows = diffRows(before, after, 1)
    const hunks = rows.filter((r) => r.hunk !== undefined).map((r) => `${r.type}${r.hunk}`)
    expect(hunks).toEqual(['del0', 'add0', 'del1', 'add1'])
  })

  it('rejecting hunk 0 reverts only that change', () => {
    expect(withHunkRejected(before, after, 0)).toBe('a\nb\nc\nD\ne')
    expect(withHunkRejected(before, after, 1)).toBe('a\nB\nc\nd\ne')
    expect(withHunkRejected(before, after, 5)).toBeNull()
  })

  it('accepting hunk 0 folds it into the baseline', () => {
    expect(withHunkAccepted(before, after, 0)).toBe('a\nB\nc\nd\ne')
    // New baseline vs disk: only hunk 1 remains in the diff.
    const newBase = withHunkAccepted(before, after, 0)!
    const remaining = diffRows(newBase, after, 1).filter((r) => r.hunk !== undefined)
    expect(remaining.map((r) => r.text)).toEqual(['d', 'D'])
  })

  it('a pure insertion hunk rejects to the original (line removed)', () => {
    const ins = withHunkRejected('a\nb', 'a\nX\nb', 0)
    expect(ins).toBe('a\nb')
  })

  it('trailing newlines round-trip through hunk operations', () => {
    // split/join keeps the trailing '' line, so EOF newlines must survive.
    const withNl = withHunkRejected('a\nb\n', 'a\nB\nb\n', 0)
    expect(withNl).toBe('a\nb\n')
    const accepted = withHunkAccepted('a\nb\n', 'a\nB\nc\nb\n', 0)
    expect(accepted).toBe('a\nB\nc\nb\n')
  })
})
