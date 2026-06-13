import { readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { type Tool, type ToolResult, ok, err } from './types'
import { resolveInside, walkFiles, globToRegExp } from './paths'

const MAX_MATCHES = 200

export const grepTool: Tool = {
  def: {
    name: 'grep',
    description: 'Search file contents with a regular expression. Returns path:line:text matches.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regular expression' },
        path: { type: 'string', description: 'Optional subdirectory to limit the search' },
        glob: { type: 'string', description: 'Optional filename glob filter, e.g. *.ts' },
      },
      required: ['pattern'],
    },
  },
  async run(input, ctx): Promise<ToolResult> {
    const pattern = String(input.pattern ?? '')
    if (!pattern) return err('grep requires pattern')
    let re: RegExp
    try {
      re = new RegExp(pattern)
    } catch (e) {
      return err(`invalid regex: ${e instanceof Error ? e.message : e}`)
    }

    let root = ctx.cwd
    if (input.path) {
      try {
        root = resolveInside(ctx.cwd, String(input.path))
      } catch (e) {
        return err(String(e instanceof Error ? e.message : e))
      }
    }
    const globRe = input.glob ? globToRegExp(`**/${input.glob}`) : null
    const NUL = String.fromCharCode(0)

    const results: string[] = []
    let matchCount = 0
    for (const file of walkFiles(root)) {
      const rel = relative(ctx.cwd, file).split(sep).join('/')
      if (globRe && !globRe.test(rel)) continue
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      if (text.includes(NUL)) continue // skip binary files
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          results.push(`${rel}:${i + 1}:${lines[i].slice(0, 300)}`)
          if (++matchCount >= MAX_MATCHES) break
        }
      }
      if (matchCount >= MAX_MATCHES) break
    }
    if (results.length === 0) return ok('(no matches)')
    return ok(results.join('\n'), { matches: matchCount, truncated: matchCount >= MAX_MATCHES })
  },
}
