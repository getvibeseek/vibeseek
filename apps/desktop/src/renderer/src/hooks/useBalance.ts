import { useEffect, useState, useCallback } from 'react'
import type { BalanceState } from '../../../shared/ipc'

/**
 * Subscribes to balance updates pushed from main and exposes a refresh().
 * The initial get() also triggers a fresh fetch on the main side.
 */
export function useBalance(): { state: BalanceState; refresh: () => void } {
  const [state, setState] = useState<BalanceState>({ status: 'no-key' })

  const refresh = useCallback(() => {
    window.api.balance.get().then(setState)
  }, [])

  useEffect(() => {
    refresh()
    return window.api.balance.onUpdate(setState)
  }, [refresh])

  return { state, refresh }
}
