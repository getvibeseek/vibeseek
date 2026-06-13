import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'

/** One user-visible memory file (透明度规则: agent 记了什么用户必须看得到). */
export interface MemoryFileInfo {
  /** Relative name within .vibeseek, e.g. 'MEMORY.md' or 'checkpoints/<id>.md'. */
  name: string
  size: number
  mtime: string
}

const MEMORY_FILE = 'MEMORY.md'
const CHECKPOINT_DIR = 'checkpoints'
const CHANGES_DIR = 'changes'

/**
 * Project-local persistent memory (致谢 MiMo-Code). Everything is
 * plain markdown under `<project>/.vibeseek/` — user-readable, editable and
 * deletable from 设置→记忆. Layout:
 *   .vibeseek/MEMORY.md               project knowledge, injected at session start
 *   .vibeseek/checkpoints/<sid>.md    per-session snapshot for compaction/restore
 */
export class ProjectMemory {
  constructor(private readonly projectDir: string) {}

  private get root(): string {
    return join(this.projectDir, '.vibeseek')
  }

  /**
   * Create `.vibeseek/` and make it self-ignoring: a `.gitignore` of `*` keeps
   * everything we stash here (memory, checkpoints, change ledgers) out of the
   * user's `git status` AND out of our own shadow checkpoints — without ever
   * touching the project's root .gitignore.
   */
  private ensureRoot(): void {
    mkdirSync(this.root, { recursive: true })
    const ignore = join(this.root, '.gitignore')
    if (!existsSync(ignore)) writeFileSync(ignore, '*\n', 'utf8')
  }

  /** Absolute path of a session's change-ledger JSON; ensures the dir exists. */
  changesFile(sessionId: string): string {
    this.ensureRoot()
    const dir = join(this.root, CHANGES_DIR)
    mkdirSync(dir, { recursive: true })
    return join(dir, `${sessionId}.json`)
  }

  /** Validated absolute path for a relative memory file name. */
  private resolve(name: string): string {
    if (name.includes('..') || name.startsWith('/') || name.includes('\\..')) {
      throw new Error(`invalid memory file name: ${name}`)
    }
    return join(this.root, name)
  }

  readMemory(): string | null {
    const p = join(this.root, MEMORY_FILE)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  writeMemory(content: string): void {
    this.ensureRoot()
    writeFileSync(join(this.root, MEMORY_FILE), content, 'utf8')
  }

  readCheckpoint(sessionId: string): string | null {
    const p = join(this.root, CHECKPOINT_DIR, `${sessionId}.md`)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  /** Checkpoint mtime in ms, or null when absent (freshness check). */
  checkpointMtime(sessionId: string): number | null {
    const p = join(this.root, CHECKPOINT_DIR, `${sessionId}.md`)
    return existsSync(p) ? statSync(p).mtimeMs : null
  }

  writeCheckpoint(sessionId: string, content: string): void {
    this.ensureRoot()
    mkdirSync(join(this.root, CHECKPOINT_DIR), { recursive: true })
    writeFileSync(join(this.root, CHECKPOINT_DIR, `${sessionId}.md`), content, 'utf8')
  }

  /** Every memory file, MEMORY.md first then checkpoints by name. */
  list(): MemoryFileInfo[] {
    const out: MemoryFileInfo[] = []
    const push = (name: string, p: string): void => {
      const st = statSync(p)
      out.push({ name, size: st.size, mtime: new Date(st.mtimeMs).toISOString() })
    }
    const mem = join(this.root, MEMORY_FILE)
    if (existsSync(mem)) push(MEMORY_FILE, mem)
    const ckDir = join(this.root, CHECKPOINT_DIR)
    if (existsSync(ckDir)) {
      for (const f of readdirSync(ckDir).sort()) {
        if (f.endsWith('.md')) push(`${CHECKPOINT_DIR}/${f}`, join(ckDir, f))
      }
    }
    return out
  }

  read(name: string): string {
    return readFileSync(this.resolve(name), 'utf8')
  }

  write(name: string, content: string): void {
    const p = this.resolve(name)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, content, 'utf8')
  }

  remove(name: string): void {
    rmSync(this.resolve(name), { force: true })
  }
}
