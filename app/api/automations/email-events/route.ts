import { NextRequest, NextResponse } from 'next/server'
import { getSendByProviderMessageId, updateDeliveryStateByProviderMessageId } from '@/db/automations/activity'
import { addEmailBlock } from '@/db/automations/emailBlocks'
import { addLeadSuppression } from '@/db/automations/suppressions'
import { findInvitationEmailOwner } from '@/db/quotes/invitations'
import { decideDeliveryEvent, recipientFrom, verifyWebhookSignature } from '@/lib/automations/deliveryEvents'

/**
 * Delivery telemetry ingestion (ADR-012). Engine-owned; the provider account
 * is SHARED with platform email, so correlation against engine send rows is
 * the runtime domain boundary: an event we do not own is ignored with zero
 * writes (spec §0).
 *
 * Idempotent by construction — the monotonic ladder guard and conflict-ignore
 * inserts make replays no-ops. No dedup ledger exists or is needed.
 * Telemetry NEVER enqueues, sends, or resumes anything.
 */

const LOG = '[automations][email-events]'

export async function POST(req: NextRequest) {
  const secret = process.env.AUTOMATIONS_WEBHOOK_SECRET?.trim() ?? ''
  if (!secret) {
    console.error(LOG, { outcome: 'misconfigured', reason: 'AUTOMATIONS_WEBHOOK_SECRET is not set' })
    return new NextResponse('Internal Server Error', { status: 500 })
  }

  // Raw body first — the signature covers the exact bytes.
  const body = await req.text()
  const verified = verifyWebhookSignature({
    secret,
    id: req.headers.get('svix-id'),
    timestamp: req.headers.get('svix-timestamp'),
    signatureHeader: req.headers.get('svix-signature'),
    body,
    nowMs: Date.now(),
  })
  if (!verified) {
    console.warn(LOG, { outcome: 'rejected', reason: 'invalid_signature' })
    return new NextResponse('Forbidden', { status: 403 })
  }

  let event: { type?: string; data?: Record<string, unknown> }
  try {
    event = JSON.parse(body)
  } catch {
    console.warn(LOG, { outcome: 'ignored', reason: 'unparseable_body' })
    return NextResponse.json({ ok: true, outcome: 'ignored' })
  }

  const type = String(event?.type ?? '')
  const data = (event?.data ?? {}) as Record<string, unknown>
  const decision = decideDeliveryEvent(type, data as never)

  if (decision.effect === 'ignore') {
    console.log(LOG, { outcome: 'ignored', type, reason: decision.reason })
    return NextResponse.json({ ok: true, outcome: 'ignored' })
  }

  const providerMessageId = typeof data.email_id === 'string' ? data.email_id : ''
  if (!providerMessageId) {
    console.log(LOG, { outcome: 'ignored', type, reason: 'no_message_id' })
    return NextResponse.json({ ok: true, outcome: 'ignored' })
  }

  // Correlation IS the boundary: no engine send row ⇒ not ours (platform
  // email on the same account) ⇒ zero writes.
  const owned = await getSendByProviderMessageId(providerMessageId)
  if (!owned) {
    // A quote's email invitation (lib/waAssistant/quotes/emailInvite.ts) is customer email on the same
    // sending identity: its complaints and hard bounces protect the address exactly like an engine send's.
    // There is no ladder for it; every other event about it changes nothing.
    // Fails soft: a lookup error must never turn platform-email telemetry into a 500 (and a Resend retry storm).
    const invite = await findInvitationEmailOwner(providerMessageId).catch(() => null)
    if (invite && decision.effect === 'suppress') {
      await addLeadSuppression(invite.agencyId, invite.leadId, 'spam_complaint')
      console.log(LOG, { outcome: 'suppressed', type, source: 'quote_invitation', agencyId: invite.agencyId, leadId: invite.leadId, reason: 'complaint' })
      return NextResponse.json({ ok: true, outcome: 'suppressed' })
    }
    const bounced = invite && decision.effect === 'ladder_and_block' ? recipientFrom(data as { to?: unknown }) : null
    if (invite && bounced) {
      await addEmailBlock(invite.agencyId, bounced, 'hard_bounce')
      console.log(LOG, { outcome: 'address_blocked', source: 'quote_invitation', agencyId: invite.agencyId, reason: 'hard_bounce' })
      return NextResponse.json({ ok: true, outcome: 'processed' })
    }
    console.log(LOG, { outcome: 'ignored', type, reason: invite ? 'quote_invitation_event' : 'not_engine_owned', providerMessageId })
    return NextResponse.json({ ok: true, outcome: 'ignored' })
  }

  if (decision.effect === 'suppress') {
    await addLeadSuppression(owned.agencyId, owned.leadId, 'spam_complaint')
    console.log(LOG, { outcome: 'suppressed', type, agencyId: owned.agencyId, leadId: owned.leadId, reason: 'complaint' })
    return NextResponse.json({ ok: true, outcome: 'suppressed' })
  }

  // Ladder: the SQL rank guard makes duplicates and out-of-order events
  // no-ops (0 rows), which is the whole idempotency story.
  const updated = await updateDeliveryStateByProviderMessageId(providerMessageId, decision.state)
  console.log(LOG, {
    outcome: updated > 0 ? 'ladder_advanced' : 'ladder_noop',
    type,
    state: decision.state,
    agencyId: owned.agencyId,
    leadId: owned.leadId,
    rowsUpdated: updated,
  })

  if (decision.effect === 'ladder_and_block') {
    const address = recipientFrom(data as { to?: unknown })
    if (address) {
      await addEmailBlock(owned.agencyId, address, 'hard_bounce')
      console.log(LOG, { outcome: 'address_blocked', agencyId: owned.agencyId, reason: 'hard_bounce' })
    } else {
      console.warn(LOG, { outcome: 'block_skipped', reason: 'no_recipient_in_payload', providerMessageId })
    }
  }

  return NextResponse.json({ ok: true, outcome: 'processed' })
}
