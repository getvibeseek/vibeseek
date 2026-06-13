import { describe, it, expect } from 'vitest'
import { completeOnce } from '../loop/complete-once'
import { ProviderClient } from '../provider/client'
import { SYSTEM_PROMPT } from './system-prompt'
import type { Message } from '../provider/types'

// acceptance: the agent replies in the language the user writes in (the
// rule lives in the static SYSTEM_PROMPT — no per-locale prompt needed). Real
// API, gated on DEEPSEEK_SMOKE_KEY like the other smokes:
//   DEEPSEEK_SMOKE_KEY=sk-... pnpm -F @vibeseek/core test -t language
const key = process.env.DEEPSEEK_SMOKE_KEY

const cjkRatio = (s: string): number => {
  const cjk = (s.match(/[一-鿿]/g) ?? []).length
  return s.length > 0 ? cjk / s.length : 0
}

const ask = async (question: string): Promise<string> => {
  const messages: Message[] = [
    { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT }] },
    { role: 'user', content: [{ type: 'text', text: question }] },
  ]
  const client = new ProviderClient({ baseUrl: 'https://api.deepseek.com', apiKey: key! })
  const { text } = await completeOnce(client, 'deepseek-v4-flash', messages)
  return text
}

describe('reply language follows input', () => {
  it.skipIf(!key)(
    'English in → English out',
    async () => {
      const text = await ask('In one sentence, what is a git branch?')
      console.log('[language] en reply:', text)
      expect(text.length).toBeGreaterThan(0)
      expect(cjkRatio(text)).toBeLessThan(0.05)
    },
    30_000
  )

  it.skipIf(!key)(
    'Chinese in → Chinese out',
    async () => {
      const text = await ask('用一句话说明什么是 git 分支？')
      console.log('[language] zh reply:', text)
      expect(cjkRatio(text)).toBeGreaterThan(0.2)
    },
    30_000
  )
})
