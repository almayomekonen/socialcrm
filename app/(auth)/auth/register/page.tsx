import type { Metadata } from 'next'
import AddAgencyForm from '@/components/agencies/AddAgencyForm'
import Icon from '@/lib/Icon'

export const metadata: Metadata = { title: 'הרשמה' }

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

          {/* Mobile-only product preview — the organized lead a new user is signing up for */}
          <div className='md:hidden w-full mt-2' dir='rtl'>
            <p className='text-xs text-gray-500 text-center mb-3'>כך ייראה הליד הראשון שלך</p>
            <div className='rounded-xl border border-gray-200 bg-white shadow-sm px-4 py-3'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <span className='inline-block w-2.5 h-2.5 bg-blue-500 rounded-full' />
                  <span className='text-sm font-medium text-gray-900'>דני לוי</span>
                </div>
                <span className='inline-block px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs font-medium'>חדש</span>
              </div>
              <p className='text-xs text-gray-500 mt-1.5 mr-[18px]'>
                <span dir='ltr'>054-XXX-XXXX</span>
              </p>
              <div className='flex items-center gap-1.5 mt-2 mr-[18px]'>
                <span className='text-xs text-gray-400'>מקור:</span>
                <Icon name='facebook-f' className='size-3 bg-gray-400' />
                <span className='text-xs text-gray-600'>Facebook Lead Ads</span>
              </div>
              <div className='flex items-center gap-1.5 mt-1.5 mr-[18px]'>
                <span className='text-xs text-gray-400'>נושא:</span>
                <span className='text-xs text-gray-600'>מעוניין בשירות</span>
              </div>
              <p className='text-xs text-gray-400 mt-2 mr-[18px]'>לפני 2 דקות</p>
            </div>
          </div>
        </div>
        <img src='/media/auth.jpg' alt='' className='w-full h-screen hidden lg:block' />
      </div>
    </div>
  )
}
