import LeadsTableSkeleton from '@/components/clients/LeadsTableSkeleton'
import { isPhoneEntity } from '@/components/mobile/skeletons/isPhoneEntity'
import LeadsSkeletonMobile from '@/components/mobile/skeletons/LeadsSkeletonMobile'

/** Closed-leads list — desktop table chrome; phone uses the leads card skeleton. */
export default async function Loading() {
  if (await isPhoneEntity()) return <LeadsSkeletonMobile />
  return <LeadsTableSkeleton withStatusTabs={false} />
}
