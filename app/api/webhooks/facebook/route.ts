import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { parseFacebookLead } from '@/lib/adapters/facebookLead'
import { createLeadFromWebhook } from '@/lib/system/createClientFromWebhook'
import { db } from '@/config/db'
import { repairFacebookConnection } from '@/lib/facebook/health'

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
  // Validate X-Hub-Signature-256 before processing anything
  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    console.error('[FacebookWebhook] META_APP_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-hub-signature-256')

  if (!signature) {
    console.warn('[FacebookWebhook] Missing X-Hub-Signature-256 header — rejecting')
    return new NextResponse('Forbidden', { status: 403 })
  }

  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const sigBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  const signatureValid = sigBuffer.length === expectedBuffer.length && timingSafeEqual(sigBuffer, expectedBuffer)

  if (!signatureValid) {
    console.warn('[FacebookWebhook] Signature mismatch — rejecting')
    return new NextResponse('Forbidden', { status: 403 })
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    console.warn('[FacebookWebhook] Invalid JSON body')
    return NextResponse.json({ ok: true })
  }

  if (!body?.entry?.[0]?.changes?.[0]?.value) {
    console.warn('[FacebookWebhook] Invalid payload structure')
    return NextResponse.json({ ok: true })
  }

  try {
    const leadId: string | undefined = body.entry[0].changes[0].value.leadgen_id
    const pageId: string | undefined = body.entry[0].id

    console.log(`[FacebookWebhook] Received — leadId=${leadId}, pageId=${pageId}`)

    if (!leadId || !pageId) {
      console.warn(`[FacebookWebhook] Missing leadId or pageId — ignoring`)
      return NextResponse.json({ ok: true })
    }

    // Skip test leads — Graph API returns code 100 for synthetic leadgen_ids
    if (leadId.startsWith('test_')) {
      console.log(`[FacebookWebhook] Skipping test lead — leadId=${leadId}`)
      return NextResponse.json({ ok: true })
    }

    // Step 1: Early idempotency check — skip Graph API call if lead already exists
    const existing = await db('clients')
      .where({ leadSource: `facebook:${leadId}` })
      .first()
    if (existing) {
      console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Already exists (id=${existing.id}) — skipping`)
      return NextResponse.json({ ok: true })
    }

    // Step 2: Resolve page connection — must exist before any Graph API call
    const connection = await db('facebook_pages').where({ page_id: pageId }).first()
    if (!connection) {
      console.warn(`[FacebookWebhook] No DB connection for pageId=${pageId} — ignoring leadId=${leadId}`)
      return NextResponse.json({ ok: true })
    }

    console.log(`[FacebookWebhook][routing][leadId=${leadId}] Resolved — pageId=${pageId}, userId=${connection.user_id}`)

    // Step 3: Fetch lead field_data with the correct page access token — single call
    let metaData: any
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 6000)
      let metaRes: Response
      try {
        metaRes = await fetch(`https://graph.facebook.com/v19.0/${leadId}?fields=field_data`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${connection.page_access_token}` },
        })
      } finally {
        clearTimeout(timeout)
      }

      if (!metaRes!.ok) {
        const errBody = await metaRes!.text()
        console.error(`[FacebookWebhook][fetch][leadId=${leadId}] Graph API error — status: ${metaRes!.status}`, errBody)

        if (metaRes!.status === 401 || metaRes!.status === 403) {
          await Promise.allSettled([
            db('facebook_pages')
              .where({ page_id: pageId })
              .update({ health_status: 'token_expired', health_checked_at: new Date() }),
            db('webhook_failures').insert({
              lead_id: leadId,
              page_id: pageId,
              error_type: 'token_expired',
              error_detail: `HTTP ${metaRes!.status}`,
            }),
          ])
          repairFacebookConnection(pageId).catch((err) =>
            console.error(`[FacebookWebhook] Background repair threw [pageId=${pageId}]:`, err),
          )
          return NextResponse.json({ ok: true })
        }

        await db('webhook_failures')
          .insert({ lead_id: leadId, page_id: pageId, error_type: 'graph_api_error', error_detail: `HTTP ${metaRes!.status}` })
          .catch(() => {})
        return NextResponse.json({ ok: true })
      }

      metaData = await metaRes!.json()
      console.log(`[FacebookWebhook][fetch][leadId=${leadId}] Lead fetched — fieldsCount=${metaData?.field_data?.length ?? 0}`)
    } catch (fetchErr: any) {
      if (fetchErr?.name === 'AbortError') {
        console.error(`[FacebookWebhook][fetch][leadId=${leadId}] Graph API timeout`)
      } else {
        console.error(`[FacebookWebhook][fetch][leadId=${leadId}] Graph API fetch threw:`, fetchErr)
      }
      await db('webhook_failures')
        .insert({ lead_id: leadId, page_id: pageId, error_type: 'timeout' })
        .catch(() => {})
      return NextResponse.json({ ok: true })
    }

    if (!Array.isArray(metaData?.field_data) || metaData.field_data.length === 0) {
      console.warn(`[FacebookWebhook][fetch][leadId=${leadId}] field_data missing or empty — ignoring`)
      return NextResponse.json({ ok: true })
    }

    const { firstName, lastName, phone, email } = parseFacebookLead(metaData.field_data)

    const lead = await createLeadFromWebhook({
      firstName,
      lastName,
      phone,
      email,
      leadId,
      agencyId: connection.agency_id,
      userId: connection.user_id,
    })

    if (!lead) {
      console.error(`[FacebookWebhook][create][leadId=${leadId}] createLeadFromWebhook returned null — logging failure`)
      await db('webhook_failures')
        .insert({ lead_id: leadId, page_id: pageId, error_type: 'db_error' })
        .catch(() => {})
      return NextResponse.json({ ok: true })
    }

    if (connection.health_status !== 'healthy') {
      await db('facebook_pages')
        .where({ page_id: pageId })
        .update({ health_status: 'healthy', health_checked_at: new Date() })
        .catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[FacebookWebhook] Unhandled error:', err)
    return NextResponse.json({ ok: true })
  }
}
