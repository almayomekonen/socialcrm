import InboxRouteSkeleton from '@/modules/inbox/components/InboxRouteSkeleton'
import { isPhoneEntity } from '@/components/mobile/skeletons/isPhoneEntity'
import InboxListSkeletonMobile from '@/components/mobile/skeletons/InboxListSkeletonMobile'
import InboxThreadSkeletonMobile from '@/components/mobile/skeletons/InboxThreadSkeletonMobile'
import { requestPathHint } from '@/components/mobile/skeletons/pathHint'

export default async function Loading() {
  if (await isPhoneEntity()) {
    const url = await requestPathHint()
    if (/[?&]conversation=/.test(url)) return <InboxThreadSkeletonMobile />
    return <InboxListSkeletonMobile />
  }
  return <InboxRouteSkeleton />
}
