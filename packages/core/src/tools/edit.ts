import { readFile, writeFile } from 'node:fs/promises'
import { type Tool, type ToolResult, ok, err } from './types'
import { resolveInside } from './paths'

export type MatchLevel = 'exact' | 'tolerant' | 'failed'

export interface EditOutcome {
  level: MatchLevel
  newContent?: string
  reason?: string
  fileLines: number
}

const REWRITE_LINE_LIMIT = 500

/**
 * Apply an old->new replacement with three-level degradation:
 *   1. exact, unique substring match
 *   2. whitespace-tolerant line match (per-line trim)
 *   3. failed — caller may fall back to a full rewrite for small files
 * DeepSeek struggles with verbatim recall, so the tolerant level recovers many
 * edits that would otherwise burn tokens retrying.
 */
export function applyEdit(fileContent: string, oldStr: string, newStr: string): EditOutcome {
  const fileLines = fileContent.split('\n').length

  // Level 1: exact, must be unique.
  const idx = fileContent.indexOf(oldStr)
  if (idx !== -1) {
    if (fileContent.indexOf(oldStr, idx + oldStr.length) !== -1) {
      return {
        level: 'failed',
        reason: 'old_str appears multiple times; add more context',
        fileLines,
      }
    }
    return {
      level: 'exact',
      newContent: fileContent.slice(0, idx) + newStr + fileContent.slice(idx + oldStr.length),
      fileLines,
    }
  }

  // Level 2: whitespace-tolerant, line-based.
  const fileArr = fileContent.split('\n')
  const oldArr = oldStr.split('\n')
  if (oldArr.at(-1) === '') oldArr.pop() // ignore a trailing newline in old_str
  const norm = (s: string): string => s.trim()
  const oN = oldArr.map(norm)
  const matches: number[] = []
  for (let i = 0; i + oN.length <= fileArr.length; i++) {
    let all = true
    for (let j = 0; j < oN.length; j++) {
      if (norm(fileArr[i + j]) !== oN[j]) {
        all = false
        break
      }
    }
    if (all) matches.push(i)
  }
  if (matches.length === 1) {
    const i = matches[0]
    const newArr = [...fileArr.slice(0, i), ...newStr.split('\n'), ...fileArr.slice(i + oN.length)]
    return { level: 'tolerant', newContent: newArr.join('\n'), fileLines }
  }
  if (matches.length > 1) return { level: 'failed', reason: 'ambiguous tolerant match', fileLines }
  return { level: 'failed', reason: 'old_str not found in file', fileLines }
}

export const editFileTool: Tool = {
  def: {
    name: 'edit_file',
    description:
      'Replace an exact snippet (old_str) with new_str in a file. old_str must ' +
      'uniquely identify the location. Falls back to whitespace-tolerant matching.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
        old_str: {
          type: 'string',
          description: 'Exact text to replace (with surrounding context)',
        },
        new_str: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_str', 'new_str'],
    },
  },
  async run(input, ctx): Promise<ToolResult> {
    const path = String(input.path ?? '')
    const oldStr = String(input.old_str ?? '')
    const newStr = String(input.new_str ?? '')
    if (!path || !oldStr) return err('edit_file requires path and old_str')

    let abs: string
    try {
      abs = resolveInside(ctx.cwd, path)
    } catch (e) {
      return err(String(e instanceof Error ? e.message : e))
    }

    let content: string
    try {
      content = await readFile(abs, 'utf8')
    } catch {
      return err(`file not found: ${path}`)
    }

    const outcome = applyEdit(content, oldStr, newStr)
    if (outcome.level === 'failed' || !outcome.newContent) {
      return err(
        `edit failed: ${outcome.reason}` +
          (outcome.fileLines <= REWRITE_LINE_LIMIT
            ? ` (file is ${outcome.fileLines} lines — consider write_file to rewrite it whole)`
            : ''),
        {
          matchLevel: 'failed',
          fileLines: outcome.fileLines,
          suggestRewrite: outcome.fileLines <= REWRITE_LINE_LIMIT,
        }
      )
    }
    await writeFile(abs, outcome.newContent, 'utf8')
    return ok(`edited ${path} (${outcome.level} match)`, { matchLevel: outcome.level })
  },
}
