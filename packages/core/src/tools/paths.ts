import { resolve, relative, isAbsolute, sep } from 'node:path'
import { readdirSync, statSync } from 'node:fs'

/** Directories never worth walking for grep/glob. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.vite', 'release'])

/**
 * Resolve a user/agent-supplied path against cwd and ensure it stays inside the
 * project root — prevents `../../etc/passwd` style escapes.
 */
export function resolveInside(cwd: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolve(cwd, p)
  const rel = relative(cwd, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path escapes project root: ${p}`)
  }
  return abs
}

/** Recursively list files under root, skipping IGNORED_DIRS. */
export function walkFiles(root: string, limit = 50_000): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length && out.length < limit) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (IGNORED_DIRS.has(name)) continue
      const full = dir + sep + name
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (st.isFile()) out.push(full)
    }
  }
  return out
}

/** Convert a glob (supports **, *, ?) to an anchored RegExp over POSIX paths. */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++ // consume the slash after **
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') re += '[^/]'
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c
    else re += c
  }
  return new RegExp('^' + re + '$')
}
