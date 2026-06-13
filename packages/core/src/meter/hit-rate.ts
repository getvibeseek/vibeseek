import type { Usage } from '../provider/types'

/**
 * Cache hit rate = hit / (hit + miss). Denominator is hit+miss, NOT prompt_tokens
 * (吸收 Kun 的口径教训) — otherwise the rate is diluted by uncacheable
 * tokens and looks worse than it is.
 */
export function turnHitRate(usage: Usage): number {
  const denom = usage.cacheHitTokens + usage.cacheMissTokens
  return denom === 0 ? 0 : usage.cacheHitTokens / denom
}

/** Accumulates hit/miss across a session for the running hit-rate indicator. */
export class HitRateAccumulator {
  private hit = 0
  private miss = 0

  add(usage: Usage): void {
    this.hit += usage.cacheHitTokens
    this.miss += usage.cacheMissTokens
  }

  get rate(): number {
    const denom = this.hit + this.miss
    return denom === 0 ? 0 : this.hit / denom
  }

  get totals(): { hit: number; miss: number } {
    return { hit: this.hit, miss: this.miss }
  }
}
