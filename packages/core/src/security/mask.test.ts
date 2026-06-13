import { describe, it, expect } from 'vitest'
import { maskApiKey } from './mask'

describe('maskApiKey', () => {
  it('keeps a short prefix and last 4 chars', () => {
    expect(maskApiKey('sk-abcdef1234567890wxyz')).toBe('sk-***wxyz')
  })

  it('fully masks very short inputs', () => {
    expect(maskApiKey('sk-12')).toBe('sk-***')
  })

  it('never reveals the middle of the key', () => {
    const masked = maskApiKey('sk-supersecretmiddle9999')
    expect(masked).not.toContain('supersecret')
  })
})
