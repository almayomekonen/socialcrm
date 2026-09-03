import { NextRequest, NextResponse } from 'next/server'
import { encrypt } from '@/db/auth'
import { requireAgencyAdmin } from '@/lib/api/routeAuth'
import { cookies } from 'next/headers'
import { resolveWabaIdsFromToken } from '@/lib/whatsapp/resolveWaba'

const REDIRECT_URI = `${process.env.NEXT_PUBLIC_BASE_URL}/api/whatsapp/callback`

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL!

const failed = (_req: NextRequest, reason: string) => NextResponse.redirect(`${BASE_URL}/settings/facebook?wa_error=${reason}`)

export async function GET(req: NextRequest) {
  // Same boundary as the start of the flow, checked before the code is
  // exchanged so a forbidden caller never causes a token to be minted.
  const auth = await requireAgencyAdmin()
  if (!auth.ok) {
    if (auth.reason === 'unauthenticated') return NextResponse.redirect(`${BASE_URL}/auth`)
    return NextResponse.redirect(`${BASE_URL}/settings/integrations?notice=forbidden`)
  }
  const user = auth.user

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error) return failed(req, 'denied')

  const cookieStore = await cookies()
  const storedState = cookieStore.get('wa_oauth_state')?.value
  cookieStore.delete('wa_oauth_state')

  if (!state || state !== storedState) return failed(req, 'state')
  if (!code) return failed(req, 'no_code')

  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!

  let shortToken: string
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${appSecret}&code=${code}`,
    )
    if (!res.ok) return failed(req, 'token')
    const data = await res.json()
    shortToken = data.access_token
  } catch {
    return failed(req, 'token')
  }

  let longToken: string
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`,
    )
    if (!res.ok) return failed(req, 'token')
    const data = await res.json()
    longToken = data.access_token
  } catch {
    return failed(req, 'token')
  }

  const wabaIds = await resolveWabaIdsFromToken(longToken, appId, appSecret)
  if (wabaIds.length === 0) return failed(req, 'no_accounts')

  // Capture the owning WABA per phone so the connect route can persist waba_id
  // (Sprint 0). Server-side only — stripped before the client sees pendingPhones.
  const phones: { id: string; displayPhone: string; verifiedName: string; wabaId: string; accessToken: string }[] = []
  for (const wabaId of wabaIds) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&access_token=${longToken}`,
      )
      if (!res.ok) continue
      const data = await res.json()
      for (const p of data.data || []) {
        phones.push({
          id: p.id,
          displayPhone: p.display_phone_number,
          verifiedName: p.verified_name,
          wabaId,
          accessToken: longToken,
        })
      }
    } catch {
      continue
    }
  }

  if (phones.length === 0) return failed(req, 'no_phones')

  const encrypted = await encrypt({ phones, userId: user.id })
  cookieStore.set('wa_phones', encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })

  return NextResponse.redirect(`${BASE_URL}/settings/facebook`)
}
