/** Balance info for one currency, mirrors DeepSeek /user/balance. */
export interface BalanceInfo {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export interface BalanceResult {
  isAvailable: boolean
  infos: BalanceInfo[]
}

/** Outcome of a balance fetch — a discriminated union the UI renders directly. */
export type BalanceState =
  | { status: 'ok'; data: BalanceResult }
  | { status: 'no-key' }
  | { status: 'invalid-key' }
  | { status: 'network-error' }
  | { status: 'timeout' }

export interface FetchBalanceOptions {
  apiKey: string
  baseUrl: string
  timeoutMs?: number
  /** Injectable fetch for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

interface RawBalance {
  is_available?: boolean
  balance_infos?: Array<{
    currency?: string
    total_balance?: string
    granted_balance?: string
    topped_up_balance?: string
  }>
}

/**
 * Fetch the account balance from DeepSeek's /user/balance endpoint. Never
 * throws — every failure maps to a BalanceState so callers branch on status
 * rather than catch. 401 -> invalid-key, abort -> timeout, anything else ->
 * network-error.
 */
export async function fetchBalance(opts: FetchBalanceOptions): Promise<BalanceState> {
  const { apiKey, baseUrl, timeoutMs = 10_000, fetchImpl = fetch } = opts
  if (!apiKey) return { status: 'no-key' }

  const url = `${baseUrl.replace(/\/+$/, '')}/user/balance`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    })

    if (res.status === 401) return { status: 'invalid-key' }
    if (!res.ok) return { status: 'network-error' }

    const raw = (await res.json()) as RawBalance
    return {
      status: 'ok',
      data: {
        isAvailable: raw.is_available ?? false,
        infos: (raw.balance_infos ?? []).map((b) => ({
          currency: b.currency ?? '',
          totalBalance: b.total_balance ?? '0',
          grantedBalance: b.granted_balance ?? '0',
          toppedUpBalance: b.topped_up_balance ?? '0',
        })),
      },
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { status: 'timeout' }
    return { status: 'network-error' }
  } finally {
    clearTimeout(timer)
  }
}
