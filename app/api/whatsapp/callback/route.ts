import { NextRequest, NextResponse } from 'next/server'
import { getUser, encrypt } from '@/db/auth'
import { cookies } from 'next/headers'

const REDIRECT_URI = `${process.env.NEXT_PUBLIC_BASE_URL}/api/whatsapp/callback`

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL!

const failed = (_req: NextRequest, reason: string, reqId = '?') => {
  console.log(`[WHATSAPP OAUTH] [${reqId}] FAILURE → /settings/facebook?wa_error=${reason} (reason=${reason})`)
  return NextResponse.redirect(`${BASE_URL}/settings/facebook?wa_error=${reason}`)
}

export async function GET(req: NextRequest) {
  const reqId = crypto.randomUUID().slice(0, 8)

  const user = await getUser()
  if (!user) {
    console.log(`[WHATSAPP OAUTH] [${reqId}] no session → /auth`)
    return NextResponse.redirect(`${BASE_URL}/auth`)
  }

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  console.log(
    `[WHATSAPP OAUTH] [${reqId}] callback params`,
    JSON.stringify(
      { userId: user.id, hasCode: !!code, codeLength: code?.length ?? 0, code: code ?? null, state, error: error ?? null },
      null,
      2,
    ),
  )

  if (error) return failed(req, 'denied', reqId)

  const cookieStore = await cookies()
  const storedState = cookieStore.get('wa_oauth_state')?.value
  cookieStore.delete('wa_oauth_state')

  console.log(
    `[WHATSAPP OAUTH] [${reqId}] state check`,
    JSON.stringify({ receivedState: state, cookieState: storedState ?? null, valid: !!state && state === storedState }, null, 2),
  )

  if (!state || state !== storedState) return failed(req, 'state', reqId)
  if (!code) return failed(req, 'no_code', reqId)

  const appId = process.env.META_APP_ID!
  const appSecret = process.env.META_APP_SECRET!

  let shortToken: string
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${appSecret}&code=${code}`,
    )
    if (!res.ok) {
      const body = await res.text()
      console.log(
        `[WHATSAPP OAUTH] [${reqId}] short token exchange FAILED`,
        JSON.stringify({ status: res.status, body }, null, 2),
      )
      return failed(req, 'token', reqId)
    }
    const data = await res.json()
    shortToken = data.access_token
    console.log(`[WHATSAPP OAUTH] [${reqId}] short token OK`, JSON.stringify({ length: shortToken?.length ?? 0 }, null, 2))
  } catch (e) {
    console.log(`[WHATSAPP OAUTH] [${reqId}] short token exchange threw`, String(e))
    return failed(req, 'token', reqId)
  }

  let longToken: string
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`,
    )
    if (!res.ok) {
      const body = await res.text()
      console.log(`[WHATSAPP OAUTH] [${reqId}] long token exchange FAILED`, JSON.stringify({ status: res.status, body }, null, 2))
      return failed(req, 'token', reqId)
    }
    const data = await res.json()
    longToken = data.access_token
    console.log(`[WHATSAPP OAUTH] [${reqId}] long token OK`, JSON.stringify({ length: longToken?.length ?? 0 }, null, 2))
  } catch (e) {
    console.log(`[WHATSAPP OAUTH] [${reqId}] long token exchange threw`, String(e))
    return failed(req, 'token', reqId)
  }

  let wabaIds: string[] = []
  try {
    const appAccessToken = `${appId}|${appSecret}`
    const dbgRes = await fetch(
      `https://graph.facebook.com/v19.0/debug_token?input_token=${longToken}&access_token=${encodeURIComponent(appAccessToken)}`,
    )
    const dbg = await dbgRes.json()
    console.log(`[WHATSAPP OAUTH] [${reqId}] [WA DEBUG TOKEN]`, JSON.stringify(dbg, null, 2))
    console.log(`[WHATSAPP OAUTH] [${reqId}] [WA GRANULAR SCOPES]`, JSON.stringify(dbg?.data?.granular_scopes, null, 2))
    const granular: { scope: string; target_ids?: string[] }[] = dbg?.data?.granular_scopes ?? []
    const targetsFor = (scope: string) => granular.find((g) => g.scope === scope)?.target_ids ?? []
    const managementTargets = targetsFor('whatsapp_business_management')
    const messagingTargets = targetsFor('whatsapp_business_messaging')
    const ids = new Set<string>(managementTargets)
    if (ids.size === 0) for (const id of messagingTargets) ids.add(id)
    wabaIds = [...ids]
    console.log(
      `[WHATSAPP OAUTH] [${reqId}] WABA extraction`,
      JSON.stringify({ managementTargets, messagingTargets, wabaIds }, null, 2),
    )
  } catch (e) {
    console.log(`[WHATSAPP OAUTH] [${reqId}] debug_token/extraction threw`, String(e))
    return failed(req, 'no_accounts', reqId)
  }
  if (wabaIds.length === 0) {
    console.log(
      `[WHATSAPP OAUTH] [${reqId}] no WABA target_ids — token granted no WhatsApp assets (predicted external-user failure point)`,
    )
    return failed(req, 'no_accounts', reqId)
  }

  const phones: { id: string; displayPhone: string; verifiedName: string; accessToken: string }[] = []
  for (const wabaId of wabaIds) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&access_token=${longToken}`,
      )
      if (!res.ok) {
        const body = await res.text()
        console.log(
          `[WHATSAPP OAUTH] [${reqId}] phone_numbers FAILED for WABA ${wabaId}`,
          JSON.stringify({ status: res.status, body }, null, 2),
        )
        continue
      }
      const data = await res.json()
      console.log(`[WHATSAPP OAUTH] [${reqId}] phone_numbers for WABA ${wabaId}`, JSON.stringify(data, null, 2))
      for (const p of data.data || []) {
        phones.push({
          id: p.id,
          displayPhone: p.display_phone_number,
          verifiedName: p.verified_name,
          accessToken: longToken,
        })
      }
    } catch (e) {
      console.log(`[WHATSAPP OAUTH] [${reqId}] phone_numbers threw for WABA ${wabaId}`, String(e))
      continue
    }
  }

  // Sections 9 — what we resolved before persisting (token omitted).
  console.log(
    `[WHATSAPP OAUTH] [${reqId}] resolved phones`,
    JSON.stringify(
      {
        count: phones.length,
        phones: phones.map((p) => ({ id: p.id, displayPhone: p.displayPhone, verifiedName: p.verifiedName })),
      },
      null,
      2,
    ),
  )

  if (phones.length === 0) return failed(req, 'no_phones', reqId)

  const encrypted = await encrypt({ phones, userId: user.id })
  cookieStore.set('wa_phones', encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  })

  // Section 10/11 — NOTE: the DB write is NOT here; it happens in
  // app/api/auth/whatsapp/connect/route.ts after the user picks a phone on /settings/facebook.
  console.log(
    `[WHATSAPP OAUTH] [${reqId}] SUCCESS — stored ${phones.length} phone(s) in wa_phones cookie → /settings/facebook (awaiting user phone selection)`,
  )

  return NextResponse.redirect(`${BASE_URL}/settings/facebook`)
}
