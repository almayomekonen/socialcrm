import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { parseFacebookLead } from '@/lib/adapters/facebookLead'
import { createLeadFromWebhook } from '@/lib/system/createClientFromWebhook'
import { db } from '@/config/db'
import { repairFacebookConnection } from '@/lib/facebook/health'
import {
  markFacebookDisconnectedAndNotify,
  notifyFacebookIngestionFailed,
} from '@/lib/facebook/integrationNotifications'
import { logCanaryFeedEvent } from '@/lib/facebook/commentsCanary'
import { ingestFacebookComment } from '@/lib/system/ingestFacebookComment'
import {
  LEAD_MINIMAL_GRAPH_FIELDS,
  buildLeadAttribution,
  leadSourceCandidates,
} from '@/lib/facebook/leadAttribution'
import { fetchLeadWithTimeout } from '@/lib/facebook/leadNodeFetch'
import { recordWebhookFailure } from '@/db/webhookFailures'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { handleMessagingEntries } from '@/lib/facebook/messenger/handleMessagingEntries'

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

// FIX 4: the fetch helper now lives in lib/facebook/leadNodeFetch so the
// recovery worker reads a lead identically to ingestion. Behaviour unchanged:
// same version, same 6s abort, same default field set.

// FIX 1: extracted to a function so the outer loop can call it per lead
async function processSingleLead(leadId: string, pageId: string, changeValue?: unknown): Promise<void> {
  // Skip test leads — Graph API returns code 100 for synthetic leadgen_ids
  if (leadId.startsWith('test_')) {
    console.log(`[FacebookWebhook] Skipping test lead — leadId=${leadId}`)
    return
  }

  // Step 1: Early idempotency check — skip Graph API call if lead already exists.
  // BOTH prefixes are checked: since Instagram separation, the same leadgen id
  // may already be stored as `facebook:` (ingested before the split) or
  // `instagram:`, and checking only one would let a redelivery create a duplicate.
  const existing = await db('clients').whereIn('leadSource', leadSourceCandidates(leadId)).first()
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

  // Sealed at rest since the token-hygiene change; legacy plaintext rows pass
  // through unchanged. A seal that cannot be opened throws into the per-lead
  // catch below, which records the failure for the retry worker.
  const pageAccessToken = resolvePageAccessToken(connection.page_access_token)

  // Step 3: Fetch lead field_data — FIX 4: retry once on timeout
  let metaRes: Response
  try {
    metaRes = await fetchLeadWithTimeout(leadId, pageAccessToken)
  } catch (firstErr: any) {
    if (firstErr?.name !== 'AbortError') {
      console.error(`[FacebookWebhook][fetch][leadId=${leadId}] Fetch threw:`, firstErr)
      await recordWebhookFailure({
        leadId,
        pageId,
        agencyId: connection.agency_id,
        errorType: 'fetch_error',
        errorDetail: String(firstErr),
      })
      await notifyFacebookIngestionFailed(connection, leadId).catch(() => {})
      return
    }
    // Timeout on first attempt — retry once
    console.warn(`[FacebookWebhook][fetch][leadId=${leadId}] Timeout on attempt 1 — retrying`)
    try {
      metaRes = await fetchLeadWithTimeout(leadId, pageAccessToken)
    } catch (retryErr: any) {
      const isAbort = retryErr?.name === 'AbortError'
      console.error(`[FacebookWebhook][fetch][leadId=${leadId}] ${isAbort ? 'Timeout' : 'Error'} on retry — giving up`)
      await recordWebhookFailure({
        leadId,
        pageId,
        agencyId: connection.agency_id,
        errorType: 'timeout',
      })
      await notifyFacebookIngestionFailed(connection, leadId).catch(() => {})
      return
    }
  }

  /**
   * ATTRIBUTION MUST NEVER COST A LEAD.
   *
   * The widened field set asks for campaign / adset / ad names alongside
   * `field_data`. Meta refuses a field set as a whole, so a single unavailable
   * field would fail the entire read and lose a paid lead — which is strictly
   * worse than having no attribution. So a refusal falls back to the shipped
   * minimal set and the lead proceeds exactly as it does today, simply without
   * campaign data.
   *
   * 401/403 is deliberately excluded: that is a dead token, not a field problem,
   * and it must reach the existing disconnect-and-repair path unchanged.
   *
   * Mirrors the PAGE_FIELDS_FULL → PAGE_FIELDS_MINIMAL ladder already proven in
   * lib/facebook/discoverPages.ts.
   */
  if (!metaRes!.ok && metaRes!.status !== 401 && metaRes!.status !== 403) {
    console.warn(
      `[FacebookWebhook][fetch][leadId=${leadId}] Widened field read refused (HTTP ${metaRes!.status}) — retrying minimal`,
    )
    try {
      const minimal = await fetchLeadWithTimeout(leadId, pageAccessToken, LEAD_MINIMAL_GRAPH_FIELDS)
      if (minimal.ok) metaRes = minimal
    } catch {
      // Keep the original response and fall through to the existing handling.
    }
  }

  if (!metaRes!.ok) {
    const errBody = await metaRes!.text()
    console.error(`[FacebookWebhook][fetch][leadId=${leadId}] Graph API error — status: ${metaRes!.status}`, errBody)

    if (metaRes!.status === 401 || metaRes!.status === 403) {
      await Promise.allSettled([
        markFacebookDisconnectedAndNotify(connection),
        recordWebhookFailure({
          leadId,
          pageId,
          agencyId: connection.agency_id,
          errorType: 'token_expired',
          errorDetail: `HTTP ${metaRes!.status}`,
        }),
      ])
      repairFacebookConnection(pageId).catch((err) =>
        console.error(`[FacebookWebhook] Background repair threw [pageId=${pageId}]:`, err),
      )
      return
    }

    await recordWebhookFailure({
      leadId,
      pageId,
      agencyId: connection.agency_id,
      errorType: 'graph_api_error',
      errorDetail: `HTTP ${metaRes!.status}`,
    })
    await notifyFacebookIngestionFailed(connection, leadId).catch(() => {})
    return
  }

  const metaData = await metaRes!.json()
  console.log(`[FacebookWebhook][fetch][leadId=${leadId}] Lead fetched — fieldsCount=${metaData?.field_data?.length ?? 0}`)

  if (!Array.isArray(metaData?.field_data) || metaData.field_data.length === 0) {
    console.warn(`[FacebookWebhook][fetch][leadId=${leadId}] field_data missing or empty — ignoring`)
    return
  }

  const { firstName, lastName, phone, email } = parseFacebookLead(metaData.field_data)

  // Both sources merged: the Graph node (authoritative, may be absent after the
  // minimal fallback) and the signed webhook body (always present). `pageId` is
  // the verified `entry.id`, never a payload field.
  const attribution = buildLeadAttribution({
    leadgenId: leadId,
    pageId,
    webhookValue: changeValue,
    graphNode: metaData,
  })

  // Captured from the create path so the dead-letter row records WHY the lead
  // was dropped (SQLSTATE + constraint, PII-free) instead of the generic
  // "returned null" that made 18 production failures indistinguishable.
  let insertErrorDetail: string | null = null

  const lead = await createLeadFromWebhook({
    firstName,
    lastName,
    phone,
    email,
    leadId,
    agencyId: connection.agency_id,
    userId: connection.user_id,
    attribution,
    onInsertError: (detail) => {
      insertErrorDetail = detail
    },
  })

  if (!lead) {
    console.error(`[FacebookWebhook][create][leadId=${leadId}] createLeadFromWebhook returned null — logging failure`)
    await recordWebhookFailure({
      leadId,
      pageId,
      agencyId: connection.agency_id,
      errorType: 'db_error',
      errorDetail: insertErrorDetail,
    })
    await notifyFacebookIngestionFailed(connection, leadId).catch(() => {})
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

    // MESSENGER: `entry.messaging[]` (never `changes`). Always acknowledged — see handleMessagingEntries.
    if (pageId && Array.isArray(entry.messaging)) await handleMessagingEntries(pageId, entry.messaging)

    if (!Array.isArray(entry.changes)) continue

    for (const change of entry.changes) {
      // FEED COMMENTS. `pageId` is `entry.id` — carried on the payload whose
      // HMAC was verified above — and is the ONLY tenancy input. Nothing inside
      // `change.value` is trusted: `ingestFacebookComment` resolves the agency
      // by looking this page up in `facebook_pages`.
      //
      // The branch is `field === 'feed' → continue`, NOT `field === 'leadgen'
      // → existing path`: gating leadgen on its field name would change which
      // payloads the shipped path accepts. Anything that is not explicitly a
      // feed event still reaches the leadgen code below byte-for-byte.
      //
      // try/catch because a malformed feed payload must never abort the batch
      // and strand a sibling leadgen event. `ingestFacebookComment` already
      // swallows its own failures; this is the second belt.
      if (change.field === 'feed') {
        try {
          logCanaryFeedEvent(pageId, change.value)
          // Calls parseFeedComment(pageId, value) internally, then persists.
          // Non-comment feed items are discarded before any query runs.
          if (pageId) await ingestFacebookComment(pageId, change.value)
        } catch (err) {
          console.error('[FacebookComments] Feed handling threw — ignoring:', err)
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
        // `change.value` carries form/ad/adgroup/created_time — the attribution
        // that was previously read for `leadgen_id` alone and then discarded.
        await processSingleLead(leadId, pageId, change.value)
      } catch (err) {
        // Catch unhandled errors per-lead so one failure does not stop other leads in the batch
        console.error(`[FacebookWebhook] Unhandled error for leadId=${leadId}:`, err)
        await recordWebhookFailure({
          leadId,
          pageId: pageId ?? 'unknown',
          errorType: 'unhandled_error',
          errorDetail: String(err),
        })
        if (pageId) {
          const connection = await db('facebook_pages').where({ page_id: pageId }).first().catch(() => null)
          if (connection) {
            await notifyFacebookIngestionFailed(connection, leadId).catch(() => {})
          }
        }
      }
    }
  }

  return NextResponse.json({ ok: true })
}
