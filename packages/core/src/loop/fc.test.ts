import { describe, it, expect } from 'vitest'
import { parseToolArguments } from './fc'

describe('parseToolArguments', () => {
  it('parses valid JSON', () => {
    expect(parseToolArguments('{"path":"a.ts","n":2}')).toEqual({ path: 'a.ts', n: 2 })
  })
  it('repairs trailing commas', () => {
    expect(parseToolArguments('{"path":"a.ts",}')).toEqual({ path: 'a.ts' })
  })
  it('extracts a JSON object wrapped in prose', () => {
    expect(parseToolArguments('here you go: {"path":"a.ts"} thanks')).toEqual({ path: 'a.ts' })
  })
  it('returns {} for empty or unrecoverable input', () => {
    expect(parseToolArguments('')).toEqual({})
    expect(parseToolArguments('not json at all')).toEqual({})
  })
})
