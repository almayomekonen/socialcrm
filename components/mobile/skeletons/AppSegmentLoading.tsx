'use client'

import { useContext } from 'react'
import { usePathname } from 'next/navigation'
import { MobileWorkspaceContext } from '@/components/mobile/MobileWorkspaceContext'
import Loading from '@/components/ui/Loading'
import MobileInnerSkeleton from './MobileInnerSkeleton'
import { useClientSearch } from './useClientSearch'

/**
 * `(app)/loading.tsx` — destination-shaped on phone, existing spinner on desktop.
 * Path comes from the router, not `headers()`, so this file can stay instant.
 */
export default function AppSegmentLoading() {
  const phone = useContext(MobileWorkspaceContext)
  const pathname = usePathname()
  const search = useClientSearch()
  if (!phone) return <Loading />
  return <MobileInnerSkeleton path={`${pathname}${search}`} />
}
