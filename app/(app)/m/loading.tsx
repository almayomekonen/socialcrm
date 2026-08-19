import Loading from '@/components/ui/Loading'
import { isPhoneEntity } from '@/components/mobile/skeletons/isPhoneEntity'
import MoreSkeletonMobile from '@/components/mobile/skeletons/MoreSkeletonMobile'

export default async function MoreLoading() {
  if (await isPhoneEntity()) return <MoreSkeletonMobile />
  return <Loading />
}
