import LeadsTableSkeleton from '@/components/clients/LeadsTableSkeleton'
import { isPhoneEntity } from '@/components/mobile/skeletons/isPhoneEntity'
import LeadsSkeletonMobile from '@/components/mobile/skeletons/LeadsSkeletonMobile'

export default async function Loading() {
  if (await isPhoneEntity()) return <LeadsSkeletonMobile />
  return <LeadsTableSkeleton withStatusTabs />
}
