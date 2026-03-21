import { NextRequest, NextResponse } from 'next/server'
import { parseFacebookLead } from '@/lib/adapters/facebookLead'
import { createLeadFromWebhook } from '@/lib/system/createClientFromWebhook'
import { db } from '@/config/db'

// GET — Meta webhook verification handshake
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('[FacebookWebhook] Verification successful')
    return new NextResponse(challenge, { status: 200 })
  }

  console.warn('[FacebookWebhook] Verification failed — token mismatch or wrong mode')
  return new NextResponse('Forbidden', { status: 403 })
}

// POST — incoming lead notification from Meta
export async function POST(req: NextRequest) {
  // Guard 1: safe JSON parsing
  let body: any
  try {
    body = await req.json()
  } catch {
    console.warn('[FacebookWebhook] Invalid JSON body')
    return NextResponse.json({ ok: true })
  }

  console.log('[FacebookWebhook] Raw payload:', JSON.stringify(body))

  // Guard 2: validate payload structure before deep access
  if (!body?.entry?.[0]?.changes?.[0]?.value) {
    console.warn('[FacebookWebhook] Invalid payload structure')
    return NextResponse.json({ ok: true })
  }

  try {
    const leadId: string | undefined = body.entry[0].changes[0].value.leadgen_id
    if (!leadId) {
      console.warn('[FacebookWebhook] No leadgen_id in payload — ignoring')
      return NextResponse.json({ ok: true })
    }

    // Fetch full lead data from Meta Graph API with 6s timeout
    let metaData: any
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 6000)

      let metaRes: Response
      try {
        metaRes = await fetch(
          `https://graph.facebook.com/v18.0/${leadId}?fields=field_data&access_token=${process.env.META_PAGE_ACCESS_TOKEN}`,
          { signal: controller.signal },
        )
      } finally {
        clearTimeout(timeout)
      }

      if (!metaRes!.ok) {
        const text = await metaRes!.text()
        console.error(`[FacebookWebhook][fetch][leadId=${leadId}] Graph API error — status: ${metaRes!.status}, body:`, text)
        return NextResponse.json({ ok: true })
      }

      metaData = await metaRes!.json()
      console.log(`[FacebookWebhook][fetch][leadId=${leadId}] Meta response:`, JSON.stringify(metaData))
    } catch (fetchErr: any) {
      if (fetchErr?.name === 'AbortError') {
        console.error(`[FacebookWebhook][fetch][leadId=${leadId}] Graph API timeout`)
      } else {
        console.error(`[FacebookWebhook][fetch][leadId=${leadId}] Graph API fetch threw:`, fetchErr)
      }
      return NextResponse.json({ ok: true })
    }

    if (!metaData?.field_data) {
      console.warn(`[FacebookWebhook][fetch][leadId=${leadId}] No field_data in Meta response — ignoring`)
      return NextResponse.json({ ok: true })
    }

    // Resolve userId, agencyId, and page token — prefer DB lookup over global env vars
    const pageId: string | undefined = body.entry[0].id
    let agencyId: number
    let userId: number
    let pageAccessToken: string

    const connection = pageId ? await db('facebook_pages').where({ page_id: pageId }).first() : null

    if (connection) {
      agencyId = connection.agency_id
      userId = connection.user_id
      pageAccessToken = connection.page_access_token
      console.log(`[FacebookWebhook][routing][leadId=${leadId}] Routed via DB — pageId=${pageId}, userId=${userId}`)
    } else {
      // Fallback to env vars for accounts not yet migrated to per-user connections
      agencyId = Number(process.env.META_AGENCY_ID)
      userId = Number(process.env.META_DEFAULT_USER_ID)
      pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN ?? ''
      if (!agencyId || !userId) {
        console.error(
          `[FacebookWebhook][create][leadId=${leadId}] No DB connection for pageId=${pageId} and env fallback vars are missing`,
        )
        return NextResponse.json({ ok: true })
      }
      console.log(`[FacebookWebhook][routing][leadId=${leadId}] Routed via env fallback — pageId=${pageId}`)
    }

    // Re-fetch lead data using the resolved page token if it differs from the global env token
    // (already fetched above using META_PAGE_ACCESS_TOKEN — re-fetch only when using per-user token)
    let resolvedMetaData = metaData
    if (connection) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 6000)
        let refetchRes: Response
        try {
          refetchRes = await fetch(
            `https://graph.facebook.com/v18.0/${leadId}?fields=field_data&access_token=${pageAccessToken}`,
            { signal: controller.signal },
          )
        } finally {
          clearTimeout(timeout)
        }
        if (refetchRes!.ok) {
          resolvedMetaData = await refetchRes!.json()
        }
      } catch (refetchErr) {
        console.warn(
          `[FacebookWebhook][refetch][leadId=${leadId}] Refetch with page token failed, using original data:`,
          refetchErr,
        )
      }
    }

    const { firstName, lastName, phone, email } = parseFacebookLead(resolvedMetaData.field_data ?? metaData.field_data)

    const lead = await createLeadFromWebhook({ firstName, lastName, phone, email, leadId, agencyId, userId })
    if (!lead) {
      console.error(`[FacebookWebhook][create][leadId=${leadId}] createLeadFromWebhook returned null`)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[FacebookWebhook] Unhandled error:', err)
    // Always return 200 — Meta will retry on non-2xx and flood the endpoint
    return NextResponse.json({ ok: true })
  }
}
