import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { parseFacebookLead } from '@/lib/adapters/facebookLead'
import { createLeadFromWebhook } from '@/lib/system/createClientFromWebhook'
import { db } from '@/config/db'
import { repairFacebookConnection } from '@/lib/facebook/health'
import { logCanaryFeedEvent } from '@/lib/facebook/commentsCanary'

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

// FIX 4: extracted fetch helper so retry can call the same logic
async function fetchLeadWithTimeout(leadId: string, accessToken: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    return await fetch(`https://graph.facebook.com/v19.0/${leadId}?fields=field_data`, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } finally {
    clearTimeout(timeout)
  }
}

// FIX 1: extracted to a function so the outer loop can call it per lead
async function processSingleLead(leadId: string, pageId: string): Promise<void> {
  // Skip test leads — Graph API returns code 100 for synthetic leadgen_ids
  if (leadId.startsWith('test_')) {
    console.log(`[FacebookWebhook] Skipping test lead — leadId=${leadId}`)
    return
  }

  // Step 1: Early idempotency check — skip Graph API call if lead already exists
  const existing = await db('clients').where({ leadSource: `facebook:${leadId}` }).first()
  if (existing) {
    console.log(`[FacebookWebhook][dedup][leadId=${leadId}] Already exists (id=${existing.id}) — skipping`)
    return
  }

  // Step 2: Resolve page connection — must exist before any Graph API call
  const connection = await db('facebook_pages').where({ page_id: pageId }).first()
  if (!connection) {
    console.warn(`[FacebookWebhook] No DB connection for pageId=${pageId} — ignoring leadId=${leadId}`)
    return
  }

  console.log(`[FacebookWebhook][routing][leadId=${leadId}] Resolved — pageId=${pageId}, userId=${connection.user_id}`)

  // Step 3: Fetch lead field_data — FIX 4: retry once on timeout
  let metaRes: Response
  try {
    metaRes = await fetchLeadWithTimeout(leadId, connection.page_access_token)
  } catch (firstErr: any) {
    if (firstErr?.name !== 'AbortError') {
      console.error(`[FacebookWebhook][fetch][leadId=${leadId}] Fetch threw:`, firstErr)
      await db('webhook_failures')
        .insert({ lead_id: leadId, page_id: pageId, error_type: 'fetch_error', error_detail: String(firstErr) })
        .catch(() => {})
      return
    }
    // Timeout on first attempt — retry once
    console.warn(`[FacebookWebhook][fetch][leadId=${leadId}] Timeout on attempt 1 — retrying`)
    try {
      metaRes = await fetchLeadWithTimeout(leadId, connection.page_access_token)
    } catch (retryErr: any) {
      const isAbort = retryErr?.name === 'AbortError'
      console.error(`[FacebookWebhook][fetch][leadId=${leadId}] ${isAbort ? 'Timeout' : 'Error'} on retry — giving up`)
      await db('webhook_failures')
        .insert({ lead_id: leadId, page_id: pageId, error_type: 'timeout' })
        .catch(() => {})
      return
    }
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
      return
    }

    await db('webhook_failures')
      .insert({ lead_id: leadId, page_id: pageId, error_type: 'graph_api_error', error_detail: `HTTP ${metaRes!.status}` })
      .catch(() => {})
    return
  }

  const metaData = await metaRes!.json()
  console.log(`[FacebookWebhook][fetch][leadId=${leadId}] Lead fetched — fieldsCount=${metaData?.field_data?.length ?? 0}`)

  if (!Array.isArray(metaData?.field_data) || metaData.field_data.length === 0) {
    console.warn(`[FacebookWebhook][fetch][leadId=${leadId}] field_data missing or empty — ignoring`)
    return
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
    return
  }

  if (connection.health_status !== 'healthy') {
    await db('facebook_pages')
      .where({ page_id: pageId })
      .update({ health_status: 'healthy', health_checked_at: new Date() })
      .catch(() => {})
  }

  console.log(`[FacebookWebhook][success][leadId=${leadId}]`)
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

  // FIX 1: validate that entries array exists
  if (!Array.isArray(body?.entry) || body.entry.length === 0) {
    console.warn('[FacebookWebhook] Invalid payload structure — no entries')
    return NextResponse.json({ ok: true })
  }

  // FIX 1: loop through ALL entries and ALL changes — Meta can batch multiple leads per delivery
  for (const entry of body.entry) {
    const pageId: string | undefined = entry.id
    if (!Array.isArray(entry.changes)) continue

    for (const change of entry.changes) {
      // CANARY EXPERIMENT (docs/facebook-comments-feasibility-audit.md §F).
      // `feed` events are observed for exactly one opted-in Page and dropped
      // for every other Page. Nothing is persisted and no Lead is created.
      //
      // The branch is `field === 'feed' → continue`, NOT `field === 'leadgen'
      // → existing path`: gating leadgen on its field name would change which
      // payloads the shipped path accepts. Anything that is not explicitly a
      // feed event still reaches the leadgen code below byte-for-byte.
      //
      // try/catch because a malformed feed payload must never abort the batch
      // and strand a sibling leadgen event.
      if (change.field === 'feed') {
        try {
          logCanaryFeedEvent(pageId, change.value)
        } catch (err) {
          console.error('[FacebookCommentsCanary] Observation threw — ignoring:', err)
        }
        continue
      }

      const leadId: string | undefined = change.value?.leadgen_id
      console.log(`[FacebookWebhook] Received — leadId=${leadId}, pageId=${pageId}`)

      if (!leadId || !pageId) {
        console.warn(`[FacebookWebhook] Missing leadId or pageId — skipping change`)
        continue
      }

      try {
        await processSingleLead(leadId, pageId)
      } catch (err) {
        // Catch unhandled errors per-lead so one failure does not stop other leads in the batch
        console.error(`[FacebookWebhook] Unhandled error for leadId=${leadId}:`, err)
        await db('webhook_failures')
          .insert({ lead_id: leadId, page_id: pageId ?? 'unknown', error_type: 'unhandled_error', error_detail: String(err) })
          .catch(() => {})
      }
    }
  }

  return NextResponse.json({ ok: true })
}
