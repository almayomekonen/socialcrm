import type { Metadata } from 'next'
import Link from 'next/link'
import AddAgencyForm from '@/components/agencies/AddAgencyForm'
import Login from '@/components/auth/Login'
import { isFacebookUserAuthOpenToNewAgencies } from '@/lib/auth/facebookUserAuthFlags'
import { isMobileRequest } from '@/lib/device'

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
          <div className='w-full max-w-sm lg:w-auto lg:max-w-none'>
            <div className='relative pt-6 pb-5'>
              <div className='absolute inset-0 flex mt-1'>
                <div className='w-full border-t border-gray-500' />
              </div>
              <div className='relative flex justify-center'>
                <span className='px-4 bg-white'>או</span>
              </div>
            </div>
            <Login
              facebookAppId={isFacebookUserAuthOpenToNewAgencies() ? process.env.AUTH_FACEBOOK_APP_ID : undefined}
              matchSocialButtons={await isMobileRequest()}
            />
            <p className='text-gray-500 text-xs text-center mt-3'>
              כבר יש לך חשבון?{' '}
              <Link href='/auth' className='text-primary-text font-semibold hover:text-primary transition-colors'>
                התחבר
              </Link>
            </p>
          </div>
        </div>
        <img src='/media/auth.jpg' alt='' className='w-full h-screen hidden lg:block' />
      </div>
    </div>
  )
}
