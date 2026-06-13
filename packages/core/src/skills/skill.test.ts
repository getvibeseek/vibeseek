import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFrontmatter, loadSkills, makeSkillTool, USE_SKILL } from './skill'

describe('parseFrontmatter', () => {
  it('extracts flat key: value fields and trims the body', () => {
    const { meta, body } = parseFrontmatter(
      '---\nname: pdf\ndescription: "Work with PDFs"\n---\n\n# Body\nDo the thing.'
    )
    expect(meta.name).toBe('pdf')
    expect(meta.description).toBe('Work with PDFs')
    expect(body).toBe('# Body\nDo the thing.')
  })

  it('treats a file with no frontmatter as all body', () => {
    const { meta, body } = parseFrontmatter('just text')
    expect(meta).toEqual({})
    expect(body).toBe('just text')
  })
})

describe('loadSkills + makeSkillTool', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibeseek-skills-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const writeSkill = (root: string, name: string, fm: string, body: string): void => {
    mkdirSync(join(dir, root, name), { recursive: true })
    writeFileSync(join(dir, root, name, 'SKILL.md'), `${fm}\n${body}`, 'utf8')
  }

  it('discovers CC-layout skills and falls back to dir name', () => {
    writeSkill('.claude/skills', 'pdf', '---\nname: pdf\ndescription: PDFs\n---', 'pdf body')
    writeSkill('skills', 'mytool', '---\ndescription: mine\n---', 'tool body')
    const skills = loadSkills([join(dir, '.claude/skills'), join(dir, 'skills')])
    const names = skills.map((s) => s.name).sort()
    expect(names).toEqual(['mytool', 'pdf'])
    expect(skills.find((s) => s.name === 'mytool')?.description).toBe('mine')
  })

  it('use_skill tool returns the body and errors on unknown name', async () => {
    writeSkill('skills', 'pdf', '---\nname: pdf\ndescription: PDFs\n---', 'the pdf instructions')
    const skills = loadSkills([join(dir, 'skills')])
    const tool = makeSkillTool(skills)!
    expect(tool.def.name).toBe(USE_SKILL)
    expect(tool.def.description).toContain('pdf: PDFs')
    const okRes = await tool.run({ name: 'pdf' }, { cwd: dir, shell: {} as never })
    expect(okRes.content).toBe('the pdf instructions')
    const errRes = await tool.run({ name: 'nope' }, { cwd: dir, shell: {} as never })
    expect(errRes.isError).toBe(true)
  })

  it('returns null tool when no skills exist', () => {
    expect(makeSkillTool([])).toBeNull()
  })
})
