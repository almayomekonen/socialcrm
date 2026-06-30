import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/db/auth'
import { cookies } from 'next/headers'

export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/auth', req.url))

  const state = crypto.randomUUID()
  const cookieStore = await cookies()
  cookieStore.set('wa_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })

  const redirectUri = `${process.env.NEXT_PUBLIC_BASE_URL}/api/whatsapp/callback`
  const scopes = ['whatsapp_business_management', 'whatsapp_business_messaging']

  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: redirectUri,
    scope: scopes.join(','),
    state,
    response_type: 'code',
  })

  // TEMP DIAGNOSTIC — remove after WhatsApp OAuth investigation. Logs only, no secrets.
  const oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`
  console.log(
    '[WHATSAPP OAUTH] authorize start',
    JSON.stringify(
      {
        userId: user.id,
        state,
        clientId: process.env.META_APP_ID,
        redirectUri,
        scopes,
        oauthUrl, // contains no secret — app id, redirect, scope, state only
      },
      null,
      2,
    ),
  )

  return NextResponse.redirect(oauthUrl)
}
