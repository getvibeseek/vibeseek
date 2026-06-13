import type { Message, ContentBlock, ToolDef } from './types'

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

/**
 * Convert internal content-block messages to OpenAI chat format. tool_result
 * blocks become standalone role:'tool' messages; tool_use blocks become the
 * assistant's tool_calls. Deterministic output — important for prefix stability:
 * same messages always serialize byte-identically.
 */
export function messagesToOpenAI(messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      const toolUses = msg.content.filter(
        (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use'
      )
      const text = textOf(msg.content)
      const m: OpenAIMessage = { role: 'assistant', content: text || null }
      if (toolUses.length > 0) {
        m.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.input) },
        }))
      }
      out.push(m)
      continue
    }

    if (msg.role === 'system') {
      out.push({ role: 'system', content: textOf(msg.content) })
      continue
    }

    // user: tool_result blocks -> role:'tool' messages; remaining text -> user
    const toolResults = msg.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_result' }> => b.type === 'tool_result'
    )
    for (const r of toolResults) {
      out.push({ role: 'tool', tool_call_id: r.toolUseId, content: r.content })
    }
    const text = textOf(msg.content)
    if (text) out.push({ role: 'user', content: text })
  }

  return out
}

export function toolsToOpenAI(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}
