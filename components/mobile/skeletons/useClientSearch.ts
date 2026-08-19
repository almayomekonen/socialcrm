'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

/** Search string without `useSearchParams()` (that API suspends). */
export function useClientSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search, () => '')
}
