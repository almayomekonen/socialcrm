import Loading from '@/components/ui/Loading'
import { isPhoneEntity } from '@/components/mobile/skeletons/isPhoneEntity'
import TodaySkeletonMobile from '@/components/mobile/skeletons/TodaySkeletonMobile'

export default async function DashboardLoading() {
  if (await isPhoneEntity()) return <TodaySkeletonMobile />
  return <Loading />
}
