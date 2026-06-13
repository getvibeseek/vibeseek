import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { Tool } from '../tools/types'
import { ok, err } from '../tools/types'

/** A loaded skill — a markdown instruction set the agent can pull in on demand. */
export interface Skill {
  name: string
  description: string
  /** Full markdown body (everything after the frontmatter). */
  body: string
  /** Absolute path of the SKILL.md it came from. */
  source: string
}

/**
 * Parse YAML-ish frontmatter: a leading `---` block of `key: value` lines.
 * Deliberately tiny (core stays dependency-free) — handles the flat string
 * fields Claude-Code SKILL.md uses (name, description). Returns the remaining
 * body untouched.
 */
export function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { meta: {}, body: text.trim() }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    let value = kv[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    meta[kv[1].toLowerCase()] = value
  }
  return { meta, body: text.slice(m[0].length).trim() }
}

/** One skill from a `<dir>/SKILL.md`, or null when absent/unreadable. */
function loadOne(dir: string): Skill | null {
  const file = join(dir, 'SKILL.md')
  if (!existsSync(file)) return null
  try {
    const { meta, body } = parseFrontmatter(readFileSync(file, 'utf8'))
    const name = meta.name || basename(dir)
    if (!name) return null
    return { name, description: meta.description || '', body, source: file }
  } catch {
    return null
  }
}

/**
 * Discover skills under each root (Claude-Code layout `<root>/<skill>/SKILL.md`).
 * Both `.claude/skills/` and a project's own `skills/` are passed in by the host,
 * so an existing CC skill works unchanged. Later roots win on name collision.
 */
export function loadSkills(roots: string[]): Skill[] {
  const byName = new Map<string, Skill>()
  for (const root of roots) {
    if (!existsSync(root)) continue
    let entries: string[]
    try {
      entries = readdirSync(root)
    } catch {
      continue
    }
    for (const entry of entries.sort()) {
      const sub = join(root, entry)
      try {
        if (!statSync(sub).isDirectory()) continue
      } catch {
        continue
      }
      const skill = loadOne(sub)
      if (skill) byName.set(skill.name, skill)
    }
  }
  return [...byName.values()]
}

export const USE_SKILL = 'use_skill'

/**
 * A read-only tool that lists the available skills in its description and
 * returns a chosen skill's full instructions as its result — so skill bodies
 * enter the conversation's active layer only when invoked, never bloating the
 * cached stable prefix. Returns null when there are no skills.
 */
export function makeSkillTool(skills: Skill[]): Tool | null {
  if (skills.length === 0) return null
  const list = skills.map((s) => `- ${s.name}: ${s.description}`).join('\n')
  return {
    def: {
      name: USE_SKILL,
      description:
        `Load a skill's full instructions by name, then follow them. ` +
        `Use this when a task matches an available skill. Available skills:\n${list}`,
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'The skill name to load.' } },
        required: ['name'],
      },
    },
    run: async (input) => {
      const name = String(input.name ?? '')
      const skill = skills.find((s) => s.name === name)
      if (!skill) {
        return err(`unknown skill: ${name}. Available: ${skills.map((s) => s.name).join(', ')}`)
      }
      return ok(skill.body)
    },
  }
}
