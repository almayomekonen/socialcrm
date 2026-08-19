import EntityLoading from '@/components/mobile/skeletons/EntityLoading'
import LeadDetailSkeletonMobile from '@/components/mobile/skeletons/LeadDetailSkeletonMobile'

export default function Loading() {
  return (
    <EntityLoading
      phone={<LeadDetailSkeletonMobile />}
      desktop={
        <div className='flex h-screen items-center justify-center'>
          <div className='animate-spin rounded-full size-32 border-t-2 border-b-2 border-dark' />
        </div>
      }
    />
  )
}
