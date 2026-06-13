export type CommandClass = 'readonly' | 'write' | 'dangerous'

// Dangerous: destructive, irreversible, or system-altering. Always double-confirm,
// even in YOLO. Windows-first but covers POSIX too.
const DANGEROUS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, // rm -rf / -fr
  /\brm\s+-r\b.*-f\b/i,
  /\bdel\s+\/[fsq]/i, // del /f /s /q
  /\brmdir\s+\/s/i,
  /\bRemove-Item\b.*-Recurse\b.*-Force\b/i,
  /\bformat\b\s+[a-z]:/i,
  /\bdiskpart\b/i,
  /\bgit\s+push\b.*(--force|-f)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\breg\s+(add|delete)\b/i,
  /\b(shutdown|reboot)\b/i,
  /\btakeown\b|\bicacls\b/i,
  /\bcurl\b.*\|\s*(sh|bash|pwsh|powershell)\b/i,
  /\bnpm\s+publish\b/i,
  /:\s*\(\s*\)\s*\{.*\|\s*:/, // fork bomb
]

// Read-only: safe to auto-run. Matched as the leading command.
const READONLY: RegExp[] = [
  /^(ls|dir|pwd|cd|echo|cat|type|head|tail|less|more|tree|stat|wc|file)\b/i,
  /^(where|which|whoami|hostname|date|env|printenv)\b/i,
  /^(grep|findstr|rg|ag|fd|find)\b/i,
  /^git\s+(status|diff|log|show|branch|remote|rev-parse|describe|blame|ls-files)\b/i,
  /^(node|npm|pnpm|yarn|python|python3|go|cargo|rustc)\s+(-v|--version)\b/i,
  /^Get-(ChildItem|Content|Location|Item|Process)\b/i,
]

/** Classify a shell command. Dangerous patterns win, then read-only, else write. */
export function classifyCommand(command: string): CommandClass {
  const cmd = command.trim()
  for (const re of DANGEROUS) if (re.test(cmd)) return 'dangerous'
  // Compound commands (&&, ;, |) that aren't pure read-only are treated as write.
  const hasChaining = /[;&|]/.test(cmd.replace(/\|\|/g, ''))
  for (const re of READONLY) if (re.test(cmd)) return hasChaining ? 'write' : 'readonly'
  return 'write'
}
