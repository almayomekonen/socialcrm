import { NextRequest } from 'next/server'
import { db } from '@/config/db'
import { createCookie, getUserByEmail } from '@/db/auth'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const email = searchParams.get('email')
  const token = searchParams.get('token')

  if (!email || !token) return failed()

  const user = await getUserByEmail(email)

  if (!user) return failed()
  if (user.suspended) return failed()
  if (user.otp?.token !== token) return failed()
  if (user.otp?.tokenExpiry < new Date()) return failed()

  await db('users').where({ id: user.id }).update({ otp: null })

  await createCookie(user.id)

  return new Response(null, {
    status: 302,
    headers: { Location: '/' },
  })
}

const failed = () => {
  return new Response(null, {
    status: 302,
    headers: { Location: '/auth?error=failed' },
  })
}
