import LeadsTableSkeleton from '@/components/clients/LeadsTableSkeleton'
import EntityLoading from '@/components/mobile/skeletons/EntityLoading'
import LeadsSkeletonMobile from '@/components/mobile/skeletons/LeadsSkeletonMobile'

/** Closed-leads list — desktop table chrome; phone uses the leads card skeleton. */
export default function Loading() {
  return (
    <EntityLoading
      phone={<LeadsSkeletonMobile />}
      desktop={<LeadsTableSkeleton withStatusTabs={false} />}
    />
  )
}
