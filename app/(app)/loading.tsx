import Loading from '@/components/ui/Loading'
import { isPhoneEntity } from '@/components/mobile/skeletons/isPhoneEntity'
import MobileInnerSkeleton from '@/components/mobile/skeletons/MobileInnerSkeleton'
import { requestPathHint } from '@/components/mobile/skeletons/pathHint'

/**
 * Segment fallback once the mobile/desktop SHELL is already mounted.
 * Phone: destination-shaped content. Desktop: existing spinner.
 */
export default async function AppLoading() {
  if (await isPhoneEntity()) return <MobileInnerSkeleton path={await requestPathHint()} />
  return <Loading />
}
