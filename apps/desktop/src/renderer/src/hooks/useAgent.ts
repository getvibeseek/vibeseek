import { useEffect, useRef, useState, useCallback } from 'react'
import type { PersistedMessage } from '../../../shared/ipc'

export interface ToolEntry {
  id: string
  name: string
  input: Record<string, unknown>
  result?: { content: string; isError?: boolean }
}

export type TranscriptItem =
  | { kind: 'user'; text: string; ts?: string; id?: number }
  | {
      kind: 'assistant'
      text: string
      reasoning: string
      tools: ToolEntry[]
      done: boolean
      /** This turn was produced in plan mode — surfaces the "转执行" CTA. */
      plan?: boolean
      ts?: string
      id?: number
    }
  | { kind: 'error'; text: string }
  | { kind: 'notice'; text: string }

export interface UseAgent {
  items: TranscriptItem[]
  running: boolean
  /** Resolved model of the in-flight task (for the running-line badge), or null. */
  runModel: string | null
  /** Epoch ms the in-flight task started — anchors the elapsed timer across switches. */
  runStartedAt: number | null
  send: (text: string, opts?: { plan?: boolean }) => void
  abort: () => void
}

/** Map persisted messages (from the DB) back into transcript items. */
function fromPersisted(messages: PersistedMessage[]): TranscriptItem[] {
  // Receipts are not inline — they live in the status bar (user feedback).
  return messages
    .filter((m) => m.role !== 'receipt')
    .map((m): TranscriptItem => {
      if (m.role === 'user') return { kind: 'user', text: m.text, ts: m.ts, id: m.id }
      if (m.role === 'error') return { kind: 'error', text: m.text }
      return {
        kind: 'assistant',
        text: m.text,
        reasoning: m.reasoning ?? '',
        tools: (m.tools ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          input: t.input,
          result: t.result,
        })),
        done: true,
        ts: m.ts,
        id: m.id,
      }
    })
}

/**
 * Walk live items and stored messages in parallel (both append-only, same
 * user/assistant order; notices/errors are interleaved locally and receipts
 * filtered server-side) and fill in missing DB ids/checkpoints so the message
 * toolbar (rewind/fork) works on freshly-sent turns without a reload.
 */
function backfillIds(items: TranscriptItem[], msgs: PersistedMessage[]): TranscriptItem[] {
  const stored = msgs.filter(
    (m) => m.role === 'user' || (m.role === 'assistant' && (m.text || m.tools?.length))
  )
  let si = 0
  return items.map((item) => {
    if (item.kind !== 'user' && item.kind !== 'assistant') return item
    // Skip assistant items that were never persisted: still streaming, or
    // finished empty (aborted before any output — those are not stored).
    if (item.kind === 'assistant' && (!item.done || (!item.text && item.tools.length === 0))) {
      return item
    }
    const m = stored[si]
    if (!m || m.role !== item.kind) return item
    si++
    if (item.id !== undefined || m.id === undefined) return item
    return { ...item, id: m.id, ts: item.ts ?? m.ts }
  })
}

export function useAgent(
  loaded: { key: number; messages: PersistedMessage[] },
  /** Session the transcript is showing; events from other sessions are ignored. */
  currentId: string | null = null
): UseAgent {
  const [items, setItems] = useState<TranscriptItem[]>([])
  const [running, setRunning] = useState(false)
  const [runModel, setRunModel] = useState<string | null>(null)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const runningRef = useRef(false)
  const currentIdRef = useRef(currentId)
  currentIdRef.current = currentId

  // Reset the transcript whenever a different session is loaded. If that session
  // has a task STILL in flight (concurrency — it kept running while we were away),
  // re-attach: mark running and seed a live assistant bubble from main's buffered
  // partial so the ongoing stream has somewhere to land.
  useEffect(() => {
    setItems(fromPersisted(loaded.messages))
    runningRef.current = false
    setRunning(false)
    setRunModel(null)
    setRunStartedAt(null)
    if (currentId === null) return
    let cancelled = false
    void window.api.agent.runningState(currentId).then((st) => {
      if (cancelled || !st.running) return
      runningRef.current = true
      setRunning(true)
      setRunModel(st.model || null)
      setRunStartedAt(st.startedAt)
      const snapTools = st.tools.map((t) => ({
        id: t.id,
        name: t.name,
        input: t.input,
        result: t.result,
      }))
      setItems((prev) => {
        // If a live bubble already exists (the stream's own events created it),
        // seed it from the snapshot rather than appending a duplicate.
        const idx = prev.map((i) => i.kind).lastIndexOf('assistant')
        const last = idx >= 0 ? (prev[idx] as Extract<TranscriptItem, { kind: 'assistant' }>) : null
        if (last && !last.done) {
          const merged = { ...last }
          if (st.text.length > merged.text.length) merged.text = st.text
          if (snapTools.length > merged.tools.length) merged.tools = snapTools
          const copy = [...prev]
          copy[idx] = merged
          return copy
        }
        return [
          ...prev,
          { kind: 'assistant', text: st.text, reasoning: '', tools: snapTools, done: false },
        ]
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.key, loaded.messages])

  useEffect(() => {
    return window.api.agent.onEvent(({ sessionId, event }) => {
      // Drop events from other sessions. A null currentId means a draft whose
      // session was just lazy-created in main — those events are ours.
      if (currentIdRef.current !== null && sessionId !== currentIdRef.current) return
      // A live stream event for our session means a task IS running — reflect it
      // even if we switched in too early to catch runningState (self-heals).
      const isStream =
        event.type === 'text' ||
        event.type === 'reasoning' ||
        event.type === 'tool_start' ||
        event.type === 'tool_end'
      if (isStream && !runningRef.current) {
        runningRef.current = true
        setRunning(true)
      }
      setItems((prev) => {
        const next = [...prev]
        let idx = next.map((i) => i.kind).lastIndexOf('assistant')
        // For a streaming event with NO in-flight assistant bubble (switched back
        // before the placeholder was re-attached), create one NOW so the delta
        // has somewhere to land instead of being dropped.
        if (isStream && (idx < 0 || (next[idx] as { done?: boolean }).done)) {
          next.push({ kind: 'assistant', text: '', reasoning: '', tools: [], done: false })
          idx = next.length - 1
        }
        const cur =
          idx >= 0 ? ({ ...next[idx] } as Extract<TranscriptItem, { kind: 'assistant' }>) : null

        switch (event.type) {
          case 'text':
            if (cur) {
              cur.text += event.delta
              next[idx] = cur
            }
            break
          case 'reasoning':
            if (cur) {
              cur.reasoning += event.delta
              next[idx] = cur
            }
            break
          case 'tool_start':
            if (cur) {
              cur.tools = [...cur.tools, { id: event.id, name: event.name, input: event.input }]
              next[idx] = cur
            }
            break
          case 'tool_end':
            if (cur) {
              cur.tools = cur.tools.map((t) =>
                t.id === event.id
                  ? {
                      ...t,
                      result: { content: event.result.content, isError: event.result.isError },
                    }
                  : t
              )
              next[idx] = cur
            }
            break
          case 'error':
            next.push({ kind: 'error', text: event.message })
            break
          case 'notice':
            // Always at the BOTTOM — that's where the user is looking during a
            // run; tucked above the live bubble it goes unseen (user feedback).
            next.push({ kind: 'notice', text: event.message })
            break
          case 'done': {
            if (cur) {
              cur.done = true
              cur.ts = new Date().toISOString()
              next[idx] = cur
            }
            runningRef.current = false
            setRunning(false)
            // Optimistically-rendered turns have no DB id, so their rewind/fork
            // buttons were missing until a reload (user report). Backfill ids
            // from the store now that the run is persisted.
            const sid = currentIdRef.current
            if (sid) {
              void window.api.session.peek(sid).then((msgs) => {
                if (currentIdRef.current !== sid) return
                setItems((items2) => backfillIds(items2, msgs))
              })
            }
            break
          }
        }
        return next
      })
    })
  }, [])

  // Safety-net reconciliation: while a task runs in the viewed session, poll the
  // full snapshot every 0.8s. Streaming events give smooth updates; this poll
  // GUARANTEES correctness even if events were missed across a window switch,
  // and keeps the model badge + start time fresh. (Fixes "switch back → blank".)
  useEffect(() => {
    if (!running || currentId === null) return
    let stop = false
    const tick = async (): Promise<void> => {
      const st = await window.api.agent.runningState(currentId)
      if (stop || !st.running) return
      if (st.model) setRunModel(st.model)
      if (st.startedAt) setRunStartedAt(st.startedAt)
      setItems((prev) => {
        const idx = prev.map((i) => i.kind).lastIndexOf('assistant')
        const last = idx >= 0 ? (prev[idx] as Extract<TranscriptItem, { kind: 'assistant' }>) : null
        // Only heal a still-streaming bubble that's fallen behind the snapshot.
        if (!last || last.done || st.text.length <= last.text.length) return prev
        const copy = [...prev]
        copy[idx] = { ...last, text: st.text }
        return copy
      })
    }
    void tick()
    const timer = setInterval(() => void tick(), 800)
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [running, currentId])

  const send = useCallback((text: string, opts?: { plan?: boolean }) => {
    if (runningRef.current || !text.trim()) return
    runningRef.current = true
    setRunning(true)
    setRunStartedAt(Date.now())
    setRunModel(null)
    setItems((prev) => [
      ...prev,
      { kind: 'user', text, ts: new Date().toISOString() },
      { kind: 'assistant', text: '', reasoning: '', tools: [], done: false, plan: opts?.plan },
    ])
    void window.api.agent.send(text)
  }, [])

  const abort = useCallback(() => window.api.agent.abort(), [])

  return { items, running, runModel, runStartedAt, send, abort }
}
