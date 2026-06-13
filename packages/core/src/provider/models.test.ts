import { describe, it, expect } from 'vitest'
import { ModelRegistry } from './models'

describe('ModelRegistry', () => {
  it('has the two V4 models with capability flags', () => {
    const reg = new ModelRegistry()
    expect(reg.has('deepseek-v4-flash')).toBe(true)
    expect(reg.has('deepseek-v4-pro')).toBe(true)
    expect(reg.defaultModel).toBe('deepseek-v4-flash')
  })

  it('exposes pricing where hit is far cheaper than miss', () => {
    const flash = new ModelRegistry().get('deepseek-v4-flash')
    expect(flash.pricing.cacheMiss / flash.pricing.cacheHit).toBeGreaterThan(40)
    expect(flash.contextWindow).toBe(1_000_000)
  })

  // Exact CNY-per-million prices from the official DeepSeek page (verified
  // 2026-06-12). Locked so a regression like the V4-Pro 4x bug can't recur.
  it('matches the official DeepSeek price sheet exactly', () => {
    const reg = new ModelRegistry()
    const flash = reg.get('deepseek-v4-flash')
    expect(flash.pricing).toEqual({ cacheHit: 0.02, cacheMiss: 1, output: 2 })
    expect(flash.maxOutput).toBe(384_000)

    const pro = reg.get('deepseek-v4-pro')
    expect(pro.pricing).toEqual({ cacheHit: 0.025, cacheMiss: 3, output: 6 })
    expect(pro.contextWindow).toBe(1_000_000)
    expect(pro.maxOutput).toBe(384_000)
  })

  it('throws on unknown model', () => {
    expect(() => new ModelRegistry().get('gpt-4')).toThrow()
  })

  it('accepts overrides', () => {
    const reg = new ModelRegistry([
      {
        id: 'custom',
        label: 'C',
        contextWindow: 1000,
        maxOutput: 100,
        pricing: { cacheHit: 1, cacheMiss: 2, output: 3 },
        supportsThinking: false,
        thinkingEfforts: ['off'],
        supportsVision: false,
        supportsFunctionCalling: true,
      },
    ])
    expect(reg.list()).toHaveLength(1)
    expect(reg.get('custom').label).toBe('C')
  })
})
