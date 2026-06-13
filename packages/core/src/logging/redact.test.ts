import { describe, it, expect } from 'vitest'
import { redactString, redactSecrets } from './redact'

describe('redactString', () => {
  it('masks an sk- API key', () => {
    const out = redactString('using key sk-abc123DEF456ghi789 now')
    expect(out).toBe('using key sk-*** now')
    expect(out).not.toContain('sk-abc123DEF456ghi789')
  })

  it('masks a Bearer token but keeps the scheme', () => {
    expect(redactString('Authorization: Bearer sk-abcdef123456')).toBe('Authorization: Bearer ***')
  })

  it('leaves clean strings untouched', () => {
    expect(redactString('nothing secret here')).toBe('nothing secret here')
  })
})

describe('redactSecrets', () => {
  it('masks values under sensitive keys', () => {
    const out = redactSecrets({
      apiKey: 'sk-abc123def456',
      Authorization: 'Bearer sk-zzz999',
      nested: { token: 'abc', safe: 'ok' },
    }) as Record<string, unknown>
    expect(out.apiKey).toBe('***')
    expect(out.Authorization).toBe('***')
    expect((out.nested as Record<string, unknown>).token).toBe('***')
    expect((out.nested as Record<string, unknown>).safe).toBe('ok')
  })

  it('redacts sk- keys embedded in non-sensitive string fields', () => {
    const out = redactSecrets({ message: 'failed with sk-abc123def456xyz' }) as Record<
      string,
      unknown
    >
    expect(out.message).toBe('failed with sk-***')
  })

  it('does not mutate the input', () => {
    const input = { apiKey: 'sk-abc123def456' }
    redactSecrets(input)
    expect(input.apiKey).toBe('sk-abc123def456')
  })
})
