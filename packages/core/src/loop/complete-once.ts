import type { Message, ToolDef, Usage } from '../provider/types'
import { EMPTY_USAGE } from '../provider/types'
import type { ChatStreamer } from './types'

/**
 * One-shot completion for background sub-agents (checkpoint writer, memory
 * extractor). Caller passes the FULL message array AND the session's tool
 * defs: sharing the cached prefix requires the request prefix to be
 * byte-identical — same system, same tools, same history — so only the
 * trailing instruction pays miss price.
 */
export async function completeOnce(
  streamer: ChatStreamer,
  model: string,
  messages: Message[],
  tools: ToolDef[] = [],
  signal?: AbortSignal
): Promise<{ text: string; usage: Usage }> {
  let text = ''
  let usage: Usage = { ...EMPTY_USAGE }
  for await (const ev of streamer.stream({ model, messages, tools, thinking: 'off' }, signal)) {
    if (ev.type === 'text') text += ev.delta
    else if (ev.type === 'done') usage = ev.result.usage
  }
  return { text: text.trim(), usage }
}
