import Loading from '@/components/ui/Loading'
import EntityLoading from '@/components/mobile/skeletons/EntityLoading'
import MoreSkeletonMobile from '@/components/mobile/skeletons/MoreSkeletonMobile'

export default function MoreLoading() {
  return (
    <EntityLoading
      phone={<MoreSkeletonMobile />}
      desktop={<Loading />}
    />
  )
}
