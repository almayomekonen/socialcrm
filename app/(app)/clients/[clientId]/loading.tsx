import { isPhoneEntity } from '@/components/mobile/skeletons/isPhoneEntity'
import LeadDetailSkeletonMobile from '@/components/mobile/skeletons/LeadDetailSkeletonMobile'

export default async function Loading() {
  if (await isPhoneEntity()) return <LeadDetailSkeletonMobile />
  return (
    <div className='flex h-screen items-center justify-center'>
      <div className='animate-spin rounded-full size-32 border-t-2 border-b-2 border-dark' />
    </div>
  )
}
