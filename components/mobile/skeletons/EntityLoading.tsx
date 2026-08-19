'use client'

import { useContext, type ReactNode } from 'react'
import { MobileWorkspaceContext } from '@/components/mobile/MobileWorkspaceContext'

/**
 * Instant loading UI: pick the skeleton for the entity already on screen.
 *
 * `loading.tsx` must stay synchronous. Awaiting `headers()` here (via
 * `isPhoneEntity` / `requestPathHint`) is what left phones stuck on a skeleton
 * after tab-to-tab client navigation — the fallback itself became a dynamic
 * Cache Components hole and never yielded to the destination page.
 *
 * Only one tree is committed. Desktop never mounts `MobileWorkspaceShell`, so
 * the default context is false and the phone skeleton is not in the DOM
 * (architecture-rules.md §9).
 */
export default function EntityLoading({
  phone,
  desktop,
}: {
  phone: ReactNode
  desktop: ReactNode
}) {
  return useContext(MobileWorkspaceContext) ? phone : desktop
}
