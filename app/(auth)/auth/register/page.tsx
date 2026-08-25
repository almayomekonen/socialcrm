import type { Metadata } from 'next'
import Link from 'next/link'
import AddAgencyForm from '@/components/agencies/AddAgencyForm'
import Login from '@/components/auth/Login'
import Logo from '@/components/lumen/layout/logo'
import { isFacebookUserAuthOpenToNewAgencies } from '@/lib/auth/facebookUserAuthFlags'
import { isMobileRequest } from '@/lib/device'

export const metadata: Metadata = { title: 'הרשמה' }

export default async function page({ searchParams }) {
  const { email, name } = await searchParams
  return (
    /* Reproduces Lumen `/signup`
       (`_reference/lumen-nextjs-template-1.0.0/src/app/signup/page.tsx`):
       the same container, the same logo + greeting + subtitle cluster, the
       field stack in `mt-6 grid gap-4` with the submit inside it, social
       buttons AFTER the submit (Lumen ships no divider), and the secondary
       nav at `mt-8 text-center text-sm`. Only the copy is ours.
       `auth.jpg` replaces Lumen's gradient panel and is untouched. */
    <div className='lumen auth-surface grid min-h-svh lg:grid-cols-2' dir='rtl'>
      <div className='container w-full max-w-sm self-center justify-self-center'>
        <div className='flex flex-col py-20 lg:py-0'>
          <div className='flex flex-col items-center gap-6 text-center'>
            <Logo onlyLogo />
            <div className='flex flex-col items-center gap-2'>
              <h1 className='text-2xl font-bold'>ברוך הבא</h1>
              <p className='text-muted-foreground text-sm'>הצטרף עכשיו והתחל לנהל את הלידים שלך בכמה צעדים</p>
            </div>
          </div>
          <div className='mt-6 grid gap-4'>
            <AddAgencyForm defaultEmail={email} defaultName={name} />
            <div className='grid gap-4 [&>div]:items-center'>
              <Login
                facebookAppId={isFacebookUserAuthOpenToNewAgencies() ? process.env.AUTH_FACEBOOK_APP_ID : undefined}
                matchSocialButtons={await isMobileRequest()}
              />
            </div>
          </div>
          <div className='mt-8 text-center text-sm'>
            כבר יש לך חשבון?{' '}
            <Link href='/auth' className='font-medium hover:underline'>
              התחבר
            </Link>
          </div>
        </div>
      </div>
      <img src='/media/auth.jpg' alt='' className='w-full h-screen hidden lg:block' />
    </div>
  )
}
