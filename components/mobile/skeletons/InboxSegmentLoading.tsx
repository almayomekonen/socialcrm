'use client'

import { useContext } from 'react'
import { MobileWorkspaceContext } from '@/components/mobile/MobileWorkspaceContext'
import InboxRouteSkeleton from '@/modules/inbox/components/InboxRouteSkeleton'
import InboxListSkeletonMobile from './InboxListSkeletonMobile'
import InboxThreadSkeletonMobile from './InboxThreadSkeletonMobile'
import { useClientSearch } from './useClientSearch'

export default function InboxSegmentLoading() {
  const phone = useContext(MobileWorkspaceContext)
  const search = useClientSearch()
  if (!phone) return <InboxRouteSkeleton />
  if (/[?&]conversation=/.test(search)) return <InboxThreadSkeletonMobile />
  return <InboxListSkeletonMobile />
}
