import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative, extname, sep } from 'node:path'

/** Directories never worth ingesting (deps, build output, our own state). */
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.vibeseek',
  'dist',
  'out',
  'build',
  '.vite',
  'release',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
])

/** Lock files / generated manifests skipped by exact name — they're huge and
 *  carry no signal for the model (a single pnpm-lock.yaml can blow the budget). */
const SKIP_NAMES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'composer.lock',
  'cargo.lock',
  'poetry.lock',
  'gemfile.lock',
  'go.sum',
])

/** Binary / non-source extensions to skip outright (cheap pre-filter). */
const SKIP_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.svg',
  '.bmp',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.mov',
  '.wav',
  '.lock',
  '.map',
  '.min.js',
  '.min.css',
])

export interface RepoDigest {
  /** Formatted file blocks, ready to append to the semi-stable context message. */
  text: string
  /** Rough token estimate (chars / 3 — matches SessionContext.estimateTokens). */
  tokenEstimate: number
  fileCount: number
  /** True if the token budget was hit and some files were omitted. */
  truncated: boolean
  /** Estimated tokens of the WHOLE repo (even when over budget), for reporting. */
  totalTokenEstimate: number
}

export interface DigestOptions {
  /** Stop ingesting once the estimate crosses this many tokens. Default 300k. */
  maxTokens?: number
  /** Skip any single file larger than this many bytes. Default 128 KB. */
  maxFileBytes?: number
}

/**
 * Whole-repo digest (全库模式): read every source file under `root` into
 * one deterministic, sorted block of `=== path ===\n<content>`. Goes into the
 * semi-stable layer so it's cached after turn 1 — the model then has the whole
 * project in context and stops needing to grep/read. Returns truncated=true if
 * the project is too big for the budget (host should fall back to normal mode).
 */
export function buildRepoDigest(root: string, opts: DigestOptions = {}): RepoDigest {
  const maxTokens = opts.maxTokens ?? 300_000
  const maxFileBytes = opts.maxFileBytes ?? 128 * 1024
  const maxChars = maxTokens * 3

  // Collect candidate files first (sorted, deterministic) so the digest is
  // byte-stable across sessions — same content ⇒ same cached prefix.
  const files: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir).sort()
    } catch {
      return
    }
    for (const name of entries) {
      if (name.startsWith('.') && name !== '.gitignore') continue
      if (IGNORE_DIRS.has(name)) continue
      const full = join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full)
      else if (
        st.isFile() &&
        !SKIP_NAMES.has(name.toLowerCase()) &&
        !SKIP_EXT.has(extname(name).toLowerCase()) &&
        st.size <= maxFileBytes
      ) {
        files.push(full)
      }
    }
  }
  walk(root)

  let text = ''
  let chars = 0
  let fileCount = 0
  let truncated = false
  let totalChars = 0 // counts the whole repo, even past the budget, for reporting
  for (const full of files) {
    let content: string
    try {
      const buf = readFileSync(full)
      if (buf.subarray(0, 8192).includes(0)) continue // binary
      content = buf.toString('utf8')
    } catch {
      continue
    }
    const rel = relative(root, full).split(sep).join('/')
    const block = `=== ${rel} ===\n${content}\n\n`
    totalChars += block.length
    if (chars + block.length > maxChars) {
      truncated = true
      continue // keep tallying totalChars to report the true size
    }
    text += block
    chars += block.length
    fileCount++
  }

  return {
    text,
    tokenEstimate: Math.ceil(chars / 3),
    fileCount,
    truncated,
    totalTokenEstimate: Math.ceil(totalChars / 3),
  }
}
