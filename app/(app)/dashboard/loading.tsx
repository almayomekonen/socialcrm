import Loading from '@/components/ui/Loading'
import EntityLoading from '@/components/mobile/skeletons/EntityLoading'
import TodaySkeletonMobile from '@/components/mobile/skeletons/TodaySkeletonMobile'

export default function DashboardLoading() {
  return (
    <EntityLoading
      phone={<TodaySkeletonMobile />}
      desktop={<Loading />}
    />
  )
}
