import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import type { Shell } from '../platform/shell'

const REF_PREFIX = 'refs/vibeseek/checkpoints'

export interface Checkpoint {
  id: string
  ref: string
  commit: string
  label: string
}

/**
 * Per-task safety net: before an agent task we snapshot the working tree
 * into a shadow commit under refs/vibeseek/checkpoints/* WITHOUT touching the
 * user's index, branch, or working tree (a throwaway index file is used). Rolling
 * back makes the working tree match the snapshot again.
 */
export class GitCheckpoints {
  constructor(
    private readonly cwd: string,
    private readonly shell: Shell
  ) {}

  private async git(
    args: string,
    env?: Record<string, string>
  ): Promise<{ out: string; code: number | null }> {
    const res = await this.shell.run(`git ${args}`, { cwd: this.cwd, env })
    return { out: res.stdout.trim(), code: res.code }
  }

  async isRepo(): Promise<boolean> {
    const { out } = await this.git('rev-parse --is-inside-work-tree')
    return out === 'true'
  }

  async init(): Promise<void> {
    await this.git('init')
  }

  /** Current branch name (works on unborn HEAD), or null when detached / not a repo. */
  async branch(): Promise<string | null> {
    const { out, code } = await this.git('branch --show-current')
    if (code !== 0 || !out) return null
    return out
  }

  /** Snapshot the current working tree into a shadow commit. Returns it, or null. */
  async create(label: string): Promise<Checkpoint | null> {
    if (!(await this.isRepo())) return null
    const id = randomUUID()
    const indexFile = join(tmpdir(), `vibeseek-index-${id}`)
    const env = { GIT_INDEX_FILE: indexFile }
    try {
      // Stage everything into the throwaway index (respects .gitignore).
      await this.git('add -A', env)
      const tree = (await this.git('write-tree', env)).out
      if (!tree) return null
      const head = await this.git('rev-parse HEAD')
      const parent = head.code === 0 && head.out ? `-p ${head.out}` : ''
      const commit = (
        await this.git(`commit-tree ${tree} ${parent} -m "vibeseek checkpoint: ${label}"`, env)
      ).out
      if (!commit) return null
      const ref = `${REF_PREFIX}/${id}`
      await this.git(`update-ref ${ref} ${commit}`)
      return { id, ref, commit, label }
    } finally {
      rmSync(indexFile, { force: true })
    }
  }

  /** Restore the working tree to a checkpoint, removing files added since. */
  async rollback(commit: string): Promise<void> {
    await this.git(`restore --source=${commit} --staged --worktree -- .`)
    await this.git('clean -fd')
  }

  async list(): Promise<Checkpoint[]> {
    // Single-quote the format: %(...) is otherwise mangled by PowerShell.
    const { out } = await this.git(
      `for-each-ref --format='%(objectname)%09%(refname)%09%(subject)' ${REF_PREFIX}`
    )
    if (!out) return []
    return out.split('\n').map((line) => {
      const [commit, ref, subject] = line.split('\t')
      return { id: ref.split('/').pop() ?? '', ref, commit, label: subject ?? '' }
    })
  }
}
