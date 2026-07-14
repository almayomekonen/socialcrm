'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  logSyncBannerOpen,
  shouldShowSyncBanner,
  type CrmSyncSource,
} from '@/lib/polling/syncFailure'

type Health = {
  failures: number
  retry: (() => void) | null
}

type CrmSyncHealthValue = {
  get: (source: CrmSyncSource) => Health
  report: (source: CrmSyncSource, failures: number, retry: (() => void) | null) => void
  isBannerVisible: (source: CrmSyncSource) => boolean
}

const EMPTY: Health = { failures: 0, retry: null }

const CrmSyncHealthContext = createContext<CrmSyncHealthValue>({
  get: () => EMPTY,
  report: () => {},
  isBannerVisible: () => false,
})

export function CrmSyncHealthProvider({ children }: { children: ReactNode }) {
  const [bySource, setBySource] = useState<Partial<Record<CrmSyncSource, Health>>>({})
  const loggedOpen = useRef<Partial<Record<CrmSyncSource, boolean>>>({})

  const report = useCallback((source: CrmSyncSource, failures: number, retry: (() => void) | null) => {
    setBySource((prev) => {
      const prevH = prev[source]
      if (prevH?.failures === failures && prevH.retry === retry) return prev
      return { ...prev, [source]: { failures, retry } }
    })
    const visible = shouldShowSyncBanner(failures)
    if (visible && !loggedOpen.current[source]) {
      loggedOpen.current[source] = true
      logSyncBannerOpen(source, failures)
    }
    if (!visible) loggedOpen.current[source] = false
  }, [])

  const value = useMemo<CrmSyncHealthValue>(
    () => ({
      get: (source) => bySource[source] ?? EMPTY,
      report,
      isBannerVisible: (source) => shouldShowSyncBanner(bySource[source]?.failures ?? 0),
    }),
    [bySource, report],
  )

  return <CrmSyncHealthContext.Provider value={value}>{children}</CrmSyncHealthContext.Provider>
}

export function useCrmSyncHealth(): CrmSyncHealthValue {
  return useContext(CrmSyncHealthContext)
}
