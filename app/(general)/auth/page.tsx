import Login from '@/components/auth/Login'
import LoginMagicLink from '@/components/auth/LoginMagicLink'
import Link from 'next/link'
import { getUser } from '@/db/auth'

export default async function AuthPage({ searchParams }) {
  const { error } = await searchParams
  const user = await getUser()

  return (
    <div className='grid lg:grid-cols-2   w-screen bg-white place-items-center'>
      <div className='grid place-items-center gap-8 py-24 lg:py-0 '>
        <h1 className='text-5xl font-bold'>ברוכים הבאים ל-SocialCRM</h1>
        <p className='text-gray-500 font-normal text-base mt-2'>כל הלידים שלך במקום אחד.
        בלי לפספס אף אחד.</p>
        <div className='grid'>
          <p className='mb-1'>התחברות עם גוגל</p>
          <Login user={user} />
          <p className='text-gray-500 text-xs text-center mt-2'>עובד עם וואטסאפ, אינסטגרם ופייסבוק</p>
          <LoginMagicLink error={error} />

          <div className='flex justify-center mt-2'>
            {/* <Link href='/auth/register' className='underline font-semibold '>
                הרשמה{' '}
              </Link> */}
          </div>
        </div>
      </div>
      <img src='/media/auth.jpg' alt='' className='w-full h-screen' />
    </div>
  )
}
