import AddAgencyForm from '@/components/agencies/AddAgencyForm'

export default async function page({ searchParams }) {
  const { email, name } = await searchParams
  return (
    <div className='min-h-screen bg-white lg:fixed lg:top-0 lg:right-0'>
      <div className='grid lg:grid-cols-2  w-screen bg-white place-items-center'>
        <div className='grid place-items-center py-14 lg:py-0 gap-6 lg:gap-8 w-full lg:w-auto max-w-sm px-6 lg:max-w-none lg:px-0'>
          {/* Mobile-only logo — same block as /auth for a consistent onboarding feel */}
          <div className='md:hidden mt-4 flex size-20 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm'>
            <img src='/media/fav.svg' alt='SocialCRM' className='size-12' />
          </div>
          <h1 className='text-3xl lg:text-5xl font-bold text-center'>מתחילים כאן</h1>
          <AddAgencyForm defaultEmail={email} defaultName={name} />
        </div>
        <img src='/media/auth.jpg' alt='' className='w-full h-screen hidden lg:block' />
      </div>
    </div>
  )
}
