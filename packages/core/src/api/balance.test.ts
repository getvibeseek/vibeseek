import { describe, it, expect, vi } from 'vitest'
import { fetchBalance } from './balance'

const OK_BODY = {
  is_available: true,
  balance_infos: [
    {
      currency: 'CNY',
      total_balance: '88.50',
      granted_balance: '10.00',
      topped_up_balance: '78.50',
    },
  ],
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response
}

describe('fetchBalance', () => {
  it('returns no-key when key is empty', async () => {
    const state = await fetchBalance({ apiKey: '', baseUrl: 'https://api.deepseek.com' })
    expect(state.status).toBe('no-key')
  })

  it('parses a successful balance response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, OK_BODY))
    const state = await fetchBalance({
      apiKey: 'sk-x',
      baseUrl: 'https://api.deepseek.com',
      fetchImpl,
    })
    expect(state).toEqual({
      status: 'ok',
      data: {
        isAvailable: true,
        infos: [
          {
            currency: 'CNY',
            totalBalance: '88.50',
            grantedBalance: '10.00',
            toppedUpBalance: '78.50',
          },
        ],
      },
    })
  })

  it('sends the bearer token and hits /user/balance', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, OK_BODY))
    await fetchBalance({ apiKey: 'sk-secret', baseUrl: 'https://api.deepseek.com/', fetchImpl })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://api.deepseek.com/user/balance')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret')
  })

  it('respects a custom base_url (third-party endpoint)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, OK_BODY))
    await fetchBalance({ apiKey: 'sk-x', baseUrl: 'https://proxy.example.com/v1', fetchImpl })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://proxy.example.com/v1/user/balance')
  })

  it('maps 401 to invalid-key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, {}))
    const state = await fetchBalance({
      apiKey: 'sk-bad',
      baseUrl: 'https://api.deepseek.com',
      fetchImpl,
    })
    expect(state.status).toBe('invalid-key')
  })

  it('maps a network failure to network-error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ENOTFOUND'))
    const state = await fetchBalance({
      apiKey: 'sk-x',
      baseUrl: 'https://api.deepseek.com',
      fetchImpl,
    })
    expect(state.status).toBe('network-error')
  })

  it('maps an abort to timeout', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      const e = new Error('aborted')
      e.name = 'AbortError'
      return Promise.reject(e)
    })
    const state = await fetchBalance({
      apiKey: 'sk-x',
      baseUrl: 'https://api.deepseek.com',
      fetchImpl,
      timeoutMs: 5,
    })
    expect(state.status).toBe('timeout')
  })
})
