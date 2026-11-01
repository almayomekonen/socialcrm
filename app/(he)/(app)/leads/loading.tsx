import LeadsTableSkeleton from '@/components/clients/LeadsTableSkeleton'
import EntityLoading from '@/components/mobile/skeletons/EntityLoading'
import LeadsSkeletonMobile from '@/components/mobile/skeletons/LeadsSkeletonMobile'

export default function Loading() {
  return (
    <EntityLoading
      phone={<LeadsSkeletonMobile />}
      desktop={<LeadsTableSkeleton withStatusTabs />}
    />
  )
}
