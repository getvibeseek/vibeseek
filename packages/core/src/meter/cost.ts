import type { Usage } from '../provider/types'
import type { Pricing } from '../provider/models'

const PER_M = 1_000_000

/** Cost of one usage record in the pricing currency (CNY). */
export function cost(usage: Usage, pricing: Pricing): number {
  return (
    (usage.cacheHitTokens * pricing.cacheHit +
      usage.cacheMissTokens * pricing.cacheMiss +
      usage.completionTokens * pricing.output) /
    PER_M
  )
}

/**
 * Money saved by cache hits vs. paying the miss price for those tokens — the
 * headline "已省" number. savings = hit * (miss - hit) / 1e6.
 */
export function savings(usage: Usage, pricing: Pricing): number {
  return (usage.cacheHitTokens * (pricing.cacheMiss - pricing.cacheHit)) / PER_M
}
