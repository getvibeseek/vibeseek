import { describe, it, expect } from 'vitest'
import { turnHitRate, HitRateAccumulator } from './hit-rate'
import { EMPTY_USAGE } from '../provider/types'

const usage = (hit: number, miss: number) => ({
  ...EMPTY_USAGE,
  cacheHitTokens: hit,
  cacheMissTokens: miss,
})

describe('hit rate', () => {
  it('uses hit/(hit+miss), not prompt_tokens', () => {
    expect(turnHitRate(usage(90, 10))).toBeCloseTo(0.9)
  })

  it('is 0 when there is no cacheable input', () => {
    expect(turnHitRate(usage(0, 0))).toBe(0)
  })

  it('accumulates across turns', () => {
    const acc = new HitRateAccumulator()
    acc.add(usage(0, 100)) // first turn: all miss
    acc.add(usage(95, 5)) // second turn: mostly hit
    expect(acc.totals).toEqual({ hit: 95, miss: 105 })
    expect(acc.rate).toBeCloseTo(95 / 200)
  })
})
