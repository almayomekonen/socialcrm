import Loading from '@/components/ui/Loading'
import EntityLoading from '@/components/mobile/skeletons/EntityLoading'
import MoreSkeletonMobile from '@/components/mobile/skeletons/MoreSkeletonMobile'

/**
 * Settings segment fallback. Integrations and Ready Messages have a more
 * specific `loading.tsx` that wins for those routes. Desktop keeps the spinner.
 */
export default function SettingsLoading() {
  return (
    <EntityLoading
      phone={<MoreSkeletonMobile />}
      desktop={<Loading />}
    />
  )
}
