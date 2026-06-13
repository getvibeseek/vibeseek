import {
  appendFileSync,
  mkdirSync,
  existsSync,
  statSync,
  renameSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { redactString, redactSecrets } from '@vibeseek/core'

export type LogLevel = 'info' | 'warn' | 'error'
export type TextChannel = 'app' | 'agent'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function datestamp(d = new Date()): string {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

/**
 * File logger with three channels: app-*.log / agent-*.log (text) and
 * api-*.jsonl (structured request log). Daily filenames, 10MB size roll, 7-day
 * retention. Every write is redacted — API keys never reach disk.
 *
 * Path-injected (no Electron import) so it can be unit tested; main passes
 * app.getPath('logs').
 */
export class Logger {
  constructor(private readonly dir: string) {
    mkdirSync(this.dir, { recursive: true })
    this.sweepOld()
  }

  appInfo(message: string, meta?: unknown): void {
    this.text('app', 'info', message, meta)
  }
  appWarn(message: string, meta?: unknown): void {
    this.text('app', 'warn', message, meta)
  }
  appError(message: string, meta?: unknown): void {
    this.text('app', 'error', message, meta)
  }

  text(channel: TextChannel, level: LogLevel, message: string, meta?: unknown): void {
    const stamp = new Date().toISOString()
    let line = `${stamp} [${level.toUpperCase()}] ${redactString(message)}`
    if (meta !== undefined) line += ` ${JSON.stringify(redactSecrets(meta))}`
    this.write(`${channel}-${datestamp()}.log`, line + '\n')
  }

  /** Structured per-request API log (one JSON object per line). */
  api(entry: Record<string, unknown>): void {
    const payload = { ts: new Date().toISOString(), ...(redactSecrets(entry) as object) }
    this.write(`api-${datestamp()}.jsonl`, JSON.stringify(payload) + '\n')
  }

  private write(filename: string, line: string): void {
    const path = join(this.dir, filename)
    this.rollIfTooBig(path)
    appendFileSync(path, line, 'utf8')
  }

  private rollIfTooBig(path: string): void {
    if (!existsSync(path)) return
    if (statSync(path).size < MAX_BYTES) return
    const suffix = new Date().toISOString().replace(/[:.]/g, '-')
    renameSync(path, path.replace(/(\.\w+)$/, `-${suffix}$1`))
  }

  private sweepOld(): void {
    const cutoff = Date.now() - RETENTION_MS
    for (const name of readdirSync(this.dir)) {
      if (!/\.(log|jsonl)$/.test(name)) continue
      const full = join(this.dir, name)
      try {
        if (statSync(full).mtimeMs < cutoff) rmSync(full, { force: true })
      } catch {
        // ignore files that vanish mid-sweep
      }
    }
  }
}
