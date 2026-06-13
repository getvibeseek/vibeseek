import { describe, it, expect } from 'vitest'
import { canonicalize, serializeTools, fingerprint, firstDiff } from './canonical'
import { SessionContext } from './session-context'
import { SYSTEM_PROMPT } from './system-prompt'
import type { ToolDef } from '../provider/types'

const toolsA: ToolDef[] = [
  {
    name: 'read_file',
    description: 'read',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
  },
  {
    name: 'grep',
    description: 'search',
    parameters: { type: 'object', properties: { pattern: { type: 'string' } } },
  },
]

describe('canonical serialization', () => {
  it('sorts object keys recursively', () => {
    expect(JSON.stringify(canonicalize({ b: 1, a: { d: 2, c: 3 } }))).toBe(
      '{"a":{"c":3,"d":2},"b":1}'
    )
  })

  it('serializes tools independent of authoring order and key order', () => {
    const reordered: ToolDef[] = [
      {
        name: 'grep',
        parameters: { properties: { pattern: { type: 'string' } }, type: 'object' },
        description: 'search',
      },
      {
        name: 'read_file',
        parameters: { properties: { path: { type: 'string' } }, type: 'object' },
        description: 'read',
      },
    ]
    expect(serializeTools(reordered)).toBe(serializeTools(toolsA))
  })

  it('firstDiff finds the divergence index', () => {
    expect(firstDiff('hello', 'hellX')).toBe(4)
    expect(firstDiff('abc', 'abc')).toBe(-1)
    expect(firstDiff('abc', 'abcd')).toBe(3)
  })
})

describe('SessionContext', () => {
  it('builds system + context + append-only active in order', () => {
    const ctx = new SessionContext({
      systemPrompt: SYSTEM_PROMPT,
      tools: toolsA,
      contextMessage: 'date: X',
    })
    ctx.append({ role: 'user', content: [{ type: 'text', text: 'first' }] })
    ctx.append({ role: 'assistant', content: [{ type: 'text', text: 'reply' }] })
    const msgs = ctx.build()
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'user', 'assistant'])
    expect(msgs[1].content[0]).toEqual({ type: 'text', text: 'date: X' })
  })

  it('does not drift when system and tools are unchanged', () => {
    const ctx = new SessionContext({
      systemPrompt: SYSTEM_PROMPT,
      tools: toolsA,
      contextMessage: 'x',
    })
    expect(ctx.verify(SYSTEM_PROMPT, toolsA).drifted).toBe(false)
  })

  it('detects a one-character system prompt drift and locates it', () => {
    const ctx = new SessionContext({
      systemPrompt: SYSTEM_PROMPT,
      tools: toolsA,
      contextMessage: 'x',
    })
    const tampered = SYSTEM_PROMPT.slice(0, 10) + 'X' + SYSTEM_PROMPT.slice(11)
    const report = ctx.verify(tampered, toolsA)
    expect(report.drifted).toBe(true)
    expect(report.layer).toBe('system')
    expect(report.at).toBe(10)
  })

  it('detects tool-set drift (mid-session tool addition)', () => {
    const ctx = new SessionContext({
      systemPrompt: SYSTEM_PROMPT,
      tools: toolsA,
      contextMessage: 'x',
    })
    const withExtra = [
      ...toolsA,
      { name: 'shell', description: 'run', parameters: { type: 'object' } },
    ]
    const report = ctx.verify(SYSTEM_PROMPT, withExtra)
    expect(report.drifted).toBe(true)
    expect(report.layer).toBe('tools')
  })

  it('system prompt has no obvious dynamic content', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/) // no date
    expect(fingerprint(SYSTEM_PROMPT)).toHaveLength(64)
  })
})
