import type { ThinkingEffort } from './types'

/** Per-million-token prices in CNY (元) — DeepSeek bills in RMB. */
export interface Pricing {
  cacheHit: number
  cacheMiss: number
  output: number
}

export interface ModelInfo {
  id: string
  label: string
  contextWindow: number
  maxOutput: number
  pricing: Pricing
  supportsThinking: boolean
  thinkingEfforts: ThinkingEffort[]
  supportsVision: boolean
  supportsFunctionCalling: boolean
}

// Prices in CNY per million tokens, from the official DeepSeek pricing page
// (api-docs.deepseek.com/zh-cn, verified 2026-06-12). DeepSeek bills in RMB and
// the balance API returns CNY, so costs are native ¥ — no exchange-rate fudge.
// Registry is the single source of truth; code reads capability flags, never
// branches on model id.
const DEFAULT_MODELS: ModelInfo[] = [
  {
    id: 'deepseek-v4-flash',
    label: 'V4 Flash',
    contextWindow: 1_000_000,
    maxOutput: 384_000,
    pricing: { cacheHit: 0.02, cacheMiss: 1, output: 2 },
    supportsThinking: true,
    thinkingEfforts: ['off', 'high', 'max'],
    supportsVision: false,
    supportsFunctionCalling: true,
  },
  {
    id: 'deepseek-v4-pro',
    label: 'V4 Pro',
    contextWindow: 1_000_000,
    maxOutput: 384_000,
    pricing: { cacheHit: 0.025, cacheMiss: 3, output: 6 },
    supportsThinking: true,
    thinkingEfforts: ['off', 'high', 'max'],
    supportsVision: false,
    supportsFunctionCalling: true,
  },
]

/**
 * Model registry. Defaults are bundled; a remote/override list can be merged in
 * later (leaves the seam — pass overrides to the constructor).
 */
export class ModelRegistry {
  private readonly byId = new Map<string, ModelInfo>()

  constructor(models: ModelInfo[] = DEFAULT_MODELS) {
    for (const m of models) this.byId.set(m.id, m)
  }

  get(id: string): ModelInfo {
    const m = this.byId.get(id)
    if (!m) throw new Error(`unknown model: ${id}`)
    return m
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  list(): ModelInfo[] {
    return [...this.byId.values()]
  }

  get defaultModel(): string {
    return 'deepseek-v4-flash'
  }
}
