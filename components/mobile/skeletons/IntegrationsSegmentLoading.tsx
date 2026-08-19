'use client'

import { useContext } from 'react'
import { MobileWorkspaceContext } from '@/components/mobile/MobileWorkspaceContext'
import Loading from '@/components/ui/Loading'
import IntegrationsSkeletonMobile from './IntegrationsSkeletonMobile'
import ReadyMessagesSkeletonMobile from './ReadyMessagesSkeletonMobile'
import { useClientSearch } from './useClientSearch'

export default function IntegrationsSegmentLoading() {
  const phone = useContext(MobileWorkspaceContext)
  const search = useClientSearch()
  if (!phone) return <Loading />
  if (/section=templates/.test(search)) return <ReadyMessagesSkeletonMobile />
  return <IntegrationsSkeletonMobile />
}
