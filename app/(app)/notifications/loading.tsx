import Loading from '@/components/ui/Loading'
import { isPhoneEntity } from '@/components/mobile/skeletons/isPhoneEntity'
import NotificationsSkeletonMobile from '@/components/mobile/skeletons/NotificationsSkeletonMobile'

export default async function NotificationsLoading() {
  if (await isPhoneEntity()) return <NotificationsSkeletonMobile />
  return <Loading />
}
