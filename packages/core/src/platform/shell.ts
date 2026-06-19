import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

export interface ShellResult {
  stdout: string
  stderr: string
  code: number | null
}

export interface ShellRunOptions {
  cwd?: string
  /** Milliseconds before the process is killed. Default: no timeout. */
  timeoutMs?: number
  /** Extra environment variables merged over process.env. */
  env?: Record<string, string>
}

/**
 * Platform shell abstraction. Windows implementation is first; mac/linux land
 * later (T-stage milestones). The contract: stdout/stderr are decoded as UTF-8
 * regardless of the host code page so non-ASCII (e.g. 中文) never garbles.
 */
export interface Shell {
  readonly platform: 'win32' | 'darwin' | 'linux'
  /** Run a single command line through the platform shell. */
  run(command: string, options?: ShellRunOptions): Promise<ShellResult>
}

class WindowsShell implements Shell {
  readonly platform = 'win32' as const

  run(command: string, options: ShellRunOptions = {}): Promise<ShellResult> {
    // A vanished cwd makes spawn fail with a MISLEADING "spawn powershell.exe
    // ENOENT" (it blames the binary, not the directory) — say what's actually
    // wrong instead. Happens when the user deletes the open project folder.
    const cwdError = checkCwd(options.cwd)
    if (cwdError) return Promise.reject(cwdError)
    // chcp 65001 switches the console to UTF-8; OutputEncoding ensures PowerShell
    // itself emits UTF-8. Together they keep 中文 from turning into mojibake.
    const prelude = 'chcp 65001 > $null; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; '
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', prelude + command],
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        windowsHide: true,
      }
    )
    return collect(child, options.timeoutMs)
  }
}

class PosixShell implements Shell {
  readonly platform: 'darwin' | 'linux'

  constructor(platform: 'darwin' | 'linux') {
    this.platform = platform
  }

  run(command: string, options: ShellRunOptions = {}): Promise<ShellResult> {
    const cwdError = checkCwd(options.cwd)
    if (cwdError) return Promise.reject(cwdError)
    const child = spawn('/bin/sh', ['-c', command], {
      cwd: options.cwd,
      env: {
        ...process.env,
        PATH: enhancePosixPath(process.env.PATH),
        LANG: 'en_US.UTF-8',
        ...options.env,
      },
    })
    return collect(child, options.timeoutMs)
  }
}

/**
 * macOS/Linux apps launched from Finder/Dock inherit a bare PATH from launchd —
 * typically `/usr/bin:/bin:/usr/sbin:/sbin` — so Homebrew binaries (git, node,
 * python…) under /opt/homebrew/bin or /usr/local/bin are invisible. That makes
 * the git safety net silently no-op (isRepo() → false → no checkpoint) and
 * breaks model-run commands. Append the well-known tool locations to whatever
 * PATH we inherited — the inherited entries keep priority, so a terminal launch
 * or a user-customized PATH still wins; we only add what's missing.
 */
export function enhancePosixPath(inherited: string | undefined = process.env.PATH): string {
  const base = inherited ?? ''
  const extra = [
    '/opt/homebrew/bin', // Apple Silicon Homebrew
    '/opt/homebrew/sbin',
    '/usr/local/bin', // Intel Homebrew & many installers
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]
  const seen = new Set(base.split(':').filter(Boolean))
  const added = extra.filter((p) => !seen.has(p))
  return [base, ...added].filter(Boolean).join(':')
}

function checkCwd(cwd?: string): Error | null {
  if (cwd && !existsSync(cwd)) {
    return new Error(`working directory does not exist: ${cwd}`)
  }
  return null
}

function collect(child: ReturnType<typeof spawn>, timeoutMs?: number): Promise<ShellResult> {
  return new Promise((resolve, reject) => {
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    let stdout = ''
    let stderr = ''
    let timer: ReturnType<typeof setTimeout> | undefined

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill()
        reject(new Error(`shell command timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }

    child.stdout?.on('data', (chunk) => (stdout += chunk))
    child.stderr?.on('data', (chunk) => (stderr += chunk))
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
  })
}

/** Returns the Shell implementation for the current platform. */
export function createShell(platform: NodeJS.Platform = process.platform): Shell {
  if (platform === 'win32') return new WindowsShell()
  if (platform === 'darwin') return new PosixShell('darwin')
  return new PosixShell('linux')
}
