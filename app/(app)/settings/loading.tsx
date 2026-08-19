import Loading from '@/components/ui/Loading'
import { isPhoneEntity } from '@/components/mobile/skeletons/isPhoneEntity'
import MoreSkeletonMobile from '@/components/mobile/skeletons/MoreSkeletonMobile'

/**
 * Settings segment fallback. Integrations and Ready Messages have a more
 * specific `loading.tsx` that wins for those routes. Desktop keeps the spinner.
 */
export default async function SettingsLoading() {
  if (await isPhoneEntity()) return <MoreSkeletonMobile />
  return <Loading />
}
