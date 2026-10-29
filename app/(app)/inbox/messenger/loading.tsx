import EntityLoading from '@/components/mobile/skeletons/EntityLoading'
import InboxListSkeletonMobile from '@/components/mobile/skeletons/InboxListSkeletonMobile'
import MessengerRouteSkeleton from '@/modules/messenger/components/MessengerRouteSkeleton'

/** Content-shaped skeleton: the conversation list pane and an empty thread pane, shell unchanged. */
export default function Loading() {
  return (
    <EntityLoading
      phone={<InboxListSkeletonMobile />}
      desktop={<MessengerRouteSkeleton />}
    />
  )
}
