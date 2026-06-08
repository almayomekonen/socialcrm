import { NextRequest, NextResponse } from 'next/server'
import { getUser, encrypt } from '@/db/auth'
import { cookies } from 'next/headers'

const REDIRECT_URI = `${process.env.NEXT_PUBLIC_BASE_URL}/api/whatsapp/callback`

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL!

const failed = (_req: NextRequest, reason: string) => NextResponse.redirect(`${BASE_URL}/settings/facebook?wa_error=${reason}`)

export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.redirect(`${BASE_URL}/auth`)

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

  let wabaIds: string[] = []
  try {
    const appAccessToken = `${appId}|${appSecret}`
    const dbgRes = await fetch(
      `https://graph.facebook.com/v19.0/debug_token?input_token=${longToken}&access_token=${encodeURIComponent(appAccessToken)}`,
    )
    const dbg = await dbgRes.json()
    const granular: { scope: string; target_ids?: string[] }[] = dbg?.data?.granular_scopes ?? []
    const targetsFor = (scope: string) => granular.find((g) => g.scope === scope)?.target_ids ?? []
    const ids = new Set<string>(targetsFor('whatsapp_business_management'))
    if (ids.size === 0) for (const id of targetsFor('whatsapp_business_messaging')) ids.add(id)
    wabaIds = [...ids]
  } catch {
    return failed(req, 'no_accounts')
  }
  if (wabaIds.length === 0) return failed(req, 'no_accounts')

  const phones: { id: string; displayPhone: string; verifiedName: string; accessToken: string }[] = []
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
