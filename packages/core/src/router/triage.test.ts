import { describe, it, expect } from 'vitest'
import { heuristicRoute, triageRoute, parseDirectives } from './triage'
import type { ChatStreamer } from '../loop/types'
import type { StreamEvent } from '../provider/types'

function replyWith(word: string, delayMs = 0): ChatStreamer {
  return {
    async *stream(): AsyncGenerator<StreamEvent> {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      yield { type: 'text', delta: word }
      yield {
        type: 'done',
        result: {
          text: word,
          reasoning: '',
          toolCalls: [],
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            cacheHitTokens: 0,
            cacheMissTokens: 0,
            reasoningTokens: 0,
          },
          finishReason: 'stop',
        },
      }
    },
  }
}

describe('heuristicRoute', () => {
  it('routes trivial copy edits to flash+off', () => {
    const d = heuristicRoute('改文案：把按钮文字换成"保存"')
    expect(d).toMatchObject({ model: 'deepseek-v4-flash', thinking: 'off', tier: 'trivial' })
  })
  it('routes refactors to pro+high', () => {
    const d = heuristicRoute('跨文件重构整个数据层')
    expect(d).toMatchObject({ model: 'deepseek-v4-pro', thinking: 'high', tier: 'complex' })
  })
  it('defaults to flash+high', () => {
    expect(heuristicRoute('给登录页加一个记住我选项')).toMatchObject({
      model: 'deepseek-v4-flash',
      thinking: 'high',
      tier: 'normal',
    })
  })
})

describe('triageRoute', () => {
  it('uses the model verdict when it answers in time', async () => {
    const d = await triageRoute(replyWith('complex'), 'x')
    expect(d).toMatchObject({ model: 'deepseek-v4-pro', source: 'triage' })
  })
  it('falls back to heuristic on timeout', async () => {
    const d = await triageRoute(replyWith('complex', 50), '改文案：错别字', 10)
    expect(d.source).toBe('heuristic')
    expect(d.tier).toBe('trivial')
  })
  it('falls back to heuristic on garbage output', async () => {
    const d = await triageRoute(replyWith('🤖???'), '加一个函数')
    expect(d.source).toBe('heuristic')
  })
})

describe('parseDirectives', () => {
  it('parses /pro and strips it', () => {
    expect(parseDirectives('/pro 修复这个bug')).toEqual({
      text: '修复这个bug',
      model: 'deepseek-v4-pro',
    })
  })
  it('stacks /flash /think', () => {
    expect(parseDirectives('/flash /think 优化算法')).toEqual({
      text: '优化算法',
      model: 'deepseek-v4-flash',
      thinking: 'max',
    })
  })
  it('/fast means flash + thinking off', () => {
    expect(parseDirectives('/fast 改个错别字')).toEqual({
      text: '改个错别字',
      model: 'deepseek-v4-flash',
      thinking: 'off',
    })
  })
  it('leaves plain text untouched', () => {
    expect(parseDirectives('普通任务 /pro 不在开头')).toEqual({ text: '普通任务 /pro 不在开头' })
  })
  it('parses /skill:<name> and stacks with model directives', () => {
    expect(parseDirectives('/skill:pdf-tools /pro 转换这份文档')).toEqual({
      text: '转换这份文档',
      skill: 'pdf-tools',
      model: 'deepseek-v4-pro',
    })
  })
})
