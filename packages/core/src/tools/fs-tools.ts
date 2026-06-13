import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, relative, sep } from 'node:path'
import { type Tool, type ToolResult, ok, err } from './types'
import { resolveInside, walkFiles, globToRegExp } from './paths'

const DEFAULT_LINE_LIMIT = 2000

export const readFileTool: Tool = {
  def: {
    name: 'read_file',
    description: 'Read a text file with line numbers. Large files paginate via offset/limit.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'number', description: '0-based first line to read' },
        limit: { type: 'number', description: `max lines (default ${DEFAULT_LINE_LIMIT})` },
      },
      required: ['path'],
    },
  },
  async run(input, ctx): Promise<ToolResult> {
    const path = String(input.path ?? '')
    if (!path) return err('read_file requires path')
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
    const lines = content.split('\n')
    const offset = Math.max(0, Number(input.offset ?? 0))
    const limit = Math.max(1, Number(input.limit ?? DEFAULT_LINE_LIMIT))
    const slice = lines.slice(offset, offset + limit)
    const numbered = slice.map((l, i) => `${String(offset + i + 1).padStart(5)}\t${l}`).join('\n')
    const truncated = offset + limit < lines.length
    return ok(numbered, {
      totalLines: lines.length,
      shown: slice.length,
      truncated,
    })
  },
}

export const writeFileTool: Tool = {
  def: {
    name: 'write_file',
    description:
      'Write (creating or overwriting) a file with the given content. Creates parent dirs.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  async run(input, ctx): Promise<ToolResult> {
    const path = String(input.path ?? '')
    const content = String(input.content ?? '')
    if (!path) return err('write_file requires path')
    let abs: string
    try {
      abs = resolveInside(ctx.cwd, path)
    } catch (e) {
      return err(String(e instanceof Error ? e.message : e))
    }
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
    return ok(`wrote ${path} (${Buffer.byteLength(content)} bytes)`)
  },
}

export const globTool: Tool = {
  def: {
    name: 'glob',
    description: 'List files matching a glob pattern (supports **, *, ?) relative to project root.',
    parameters: {
      type: 'object',
      properties: { pattern: { type: 'string', description: 'e.g. src/**/*.ts' } },
      required: ['pattern'],
    },
  },
  async run(input, ctx): Promise<ToolResult> {
    const pattern = String(input.pattern ?? '')
    if (!pattern) return err('glob requires pattern')
    const re = globToRegExp(pattern)
    const files = walkFiles(ctx.cwd)
      .map((f) => relative(ctx.cwd, f).split(sep).join('/'))
      .filter((rel) => re.test(rel))
      .sort()
    if (files.length === 0) return ok('(no matches)')
    const limited = files.slice(0, 1000)
    return ok(limited.join('\n'), { matches: files.length, truncated: files.length > 1000 })
  },
}
