import type { ChatStreamer } from '../loop/types'
import type { ThinkingEffort } from '../provider/types'

export interface RouteDecision {
  model: string
  thinking: ThinkingEffort
  /** How the decision was made — surfaced to the user. */
  source: 'triage' | 'heuristic'
  tier: 'trivial' | 'normal' | 'complex'
}

const FLASH = 'deepseek-v4-flash'
const PRO = 'deepseek-v4-pro'

function decisionOf(tier: RouteDecision['tier'], source: RouteDecision['source']): RouteDecision {
  // 琐碎→Flash+off；常规→Flash+high；复杂→Pro+high.
  if (tier === 'trivial') return { model: FLASH, thinking: 'off', source, tier }
  if (tier === 'complex') return { model: PRO, thinking: 'high', source, tier }
  return { model: FLASH, thinking: 'high', source, tier }
}

const COMPLEX_HINTS =
  /重构|架构|跨文件|疑难|多个文件|整个项目|全局|迁移|refactor|architecture|migrate|across|redesign|debug.*(race|deadlock|memory)/i
const TRIVIAL_HINTS =
  /改文案|错别字|改个|重命名|拼写|typo|rename|注释|comment|版本号|颜色|文档里|readme/i

/** Zero-cost fallback when the triage call is unavailable or times out. */
export function heuristicRoute(text: string): RouteDecision {
  const t = text.trim()
  if (TRIVIAL_HINTS.test(t) && t.length < 200) return decisionOf('trivial', 'heuristic')
  if (COMPLEX_HINTS.test(t) || t.length > 600) return decisionOf('complex', 'heuristic')
  return decisionOf('normal', 'heuristic')
}

// Static triage prompt (its own stable cache prefix — never varies).
const TRIAGE_SYSTEM = `You are a coding-task complexity classifier. Reply with exactly one word:
trivial  — copy edits, single-line tweaks, renames, comments
normal   — a new function, small feature, a test, a contained fix
complex  — cross-file refactors, architecture work, hard bugs
No other text.`

/**
 * Auto-triage: a tiny flash call (thinking off) scores the task; falls
 * back to the heuristic on timeout/error. Costs ~nothing once its prefix caches.
 */
export async function triageRoute(
  streamer: ChatStreamer,
  text: string,
  timeoutMs = 4000
): Promise<RouteDecision> {
  const controller = new AbortController()
  const consume = async (): Promise<string> => {
    let reply = ''
    for await (const ev of streamer.stream(
      {
        model: FLASH,
        messages: [
          { role: 'system', content: [{ type: 'text', text: TRIAGE_SYSTEM }] },
          { role: 'user', content: [{ type: 'text', text: text.slice(0, 1500) }] },
        ],
        thinking: 'off',
        maxTokens: 8,
      },
      controller.signal
    )) {
      if (ev.type === 'text') reply += ev.delta
    }
    return reply
  }
  try {
    // Race a hard timeout — don't rely on the streamer honoring the signal.
    const reply = await Promise.race([
      consume(),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ])
    if (reply === null) {
      controller.abort()
      return heuristicRoute(text)
    }
    const word = reply.trim().toLowerCase()
    if (word.includes('trivial')) return decisionOf('trivial', 'triage')
    if (word.includes('complex')) return decisionOf('complex', 'triage')
    if (word.includes('normal')) return decisionOf('normal', 'triage')
    return heuristicRoute(text)
  } catch {
    return heuristicRoute(text)
  }
}

export interface ParsedDirectives {
  text: string
  model?: string
  thinking?: ThinkingEffort
  /** A skill the user pinned with /skill:<name> — the host forces use_skill. */
  skill?: string
}

/**
 * Leading slash-command overrides: /pro /flash /think /fast, plus
 * /skill:<name> (manual skill invocation). Multiple directives may stack
 * ("/pro /think 修复…"). Returns the stripped task text.
 */
export function parseDirectives(input: string): ParsedDirectives {
  let rest = input.trimStart()
  const out: ParsedDirectives = { text: input }
  for (;;) {
    const ms = rest.match(/^\/skill:([\w.-]+)\s*/i)
    if (ms) {
      out.skill = ms[1]
      rest = rest.slice(ms[0].length)
      continue
    }
    const m = rest.match(/^\/(pro|flash|think|fast)\b\s*/i)
    if (!m) break
    const cmd = m[1].toLowerCase()
    if (cmd === 'pro') out.model = PRO
    else if (cmd === 'flash') out.model = FLASH
    else if (cmd === 'think') out.thinking = 'max'
    else if (cmd === 'fast') {
      out.model = FLASH
      out.thinking = 'off'
    }
    rest = rest.slice(m[0].length)
  }
  out.text = rest
  return out
}
