import Loading from '@/components/ui/Loading'
import EntityLoading from '@/components/mobile/skeletons/EntityLoading'
import NotificationsSkeletonMobile from '@/components/mobile/skeletons/NotificationsSkeletonMobile'

export default function NotificationsLoading() {
  return (
    <EntityLoading
      phone={<NotificationsSkeletonMobile />}
      desktop={<Loading />}
    />
  )
}
