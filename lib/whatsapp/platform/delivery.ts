import { NextResponse, after } from 'next/server'
import { processPlatformChanges, type GuidanceReply } from './inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { platformBatchResponse, type WebhookSplit } from './webhookBatch'
import { platformWhatsappAccessToken, platformWhatsappPhoneNumberId } from '@/lib/flags/ownerWhatsappReminderFlags'
import { sendPlatformText } from './sendText'

/**
 * A webhook delivery that carried platform-number changes: the agency path
 * first (unchanged, on the body with platform changes removed), then the
 * platform changes. The answer to Meta is decided by `platformBatchResponse`,
 * which says why a failed platform save is sometimes acknowledged and lost
 * rather than retried. An exception from the agency path propagates exactly as
 * it would without platform changes.
 */
export async function handleDeliveryWithPlatformChanges(
  split: WebhookSplit,
  handleAgencyPayload: (body: unknown) => Promise<NextResponse>,
): Promise<NextResponse> {
  const agencyResponse = split.agencyBody ? await handleAgencyPayload(split.agencyBody) : null
  const platform = await processPlatformChanges(split.platform)
  const decision = platformBatchResponse({
    agencyStatus: agencyResponse?.status ?? null,
    platformOk: platform.ok,
    agencyFields: split.agencyFields,
  })
  if (decision.unsavedPlatformEvent) {
    // Structured, no content and no identifiers: the count and the agency fields
    // that made a retry unsafe. Never claims the event was saved.
    console.error('[WhatsappWebhook][platform] event NOT saved; acknowledged to avoid replaying agency changes', {
      unsavedMessages: platform.failed,
      agencyFields: split.agencyFields,
    })
  }
  if (platform.outcomes.includes('assistant_queued')) kickAssistant()
  if (platform.guidance.length) sendGuidanceAfterResponse(platform.guidance)
  if (decision.useAgencyResponse && agencyResponse) return agencyResponse
  return NextResponse.json({ ok: decision.status < 300 }, { status: decision.status })
}

/**
 * Answer the owner right after Meta gets its 200, not on the next cron tick.
 * The job is already committed; if this cannot run (or fails), the minute-ly
 * /api/cron/wa-assistant drains it.
 */
/**
 * Fixed guidance replies (senderGuidance.ts), after Meta gets its 200. Each was
 * decided once, inside its message's committed transaction, so it is sent ONCE:
 * no retry, and an unknown outcome is never resent. The reply answers the
 * sender's own message, inside Meta's customer service window.
 */
export async function sendGuidanceReplies(replies: GuidanceReply[]): Promise<void> {
  const phoneNumberId = platformWhatsappPhoneNumberId()
  const accessToken = platformWhatsappAccessToken()
  for (const r of replies) {
    if (!phoneNumberId || !accessToken) {
      console.warn('[WaAssistant][guidance] platform number not configured; not sent', { kind: r.kind })
      continue
    }
    const outcome = await sendPlatformText({
      phoneNumberId,
      accessToken,
      toE164: `+${r.toDigits}`,
      body: r.body,
      replyToWamid: r.replyToWamid,
      jobId: 0,
    })
    console.log('[WaAssistant][guidance]', { kind: r.kind, outcome: outcome.kind })
  }
}

function sendGuidanceAfterResponse(replies: GuidanceReply[]): void {
  try {
    after(async () => {
      try {
        await sendGuidanceReplies(replies)
      } catch (err) {
        console.error('[WaAssistant][guidance] failed', { name: (err as Error)?.name ?? null })
      }
    })
  } catch {
    // Outside a request scope (tests, scripts): nothing to send from here.
  }
}

function kickAssistant(): void {
  try {
    after(async () => {
      try {
        const r = await runWaAssistantWorker()
        console.log('[WaAssistant][kick]', { claimed: r.claimed, outcomes: r.outcomes })
      } catch (err) {
        console.error('[WaAssistant][kick] failed', { name: (err as Error)?.name ?? null })
      }
    })
  } catch {
    // Outside a request scope (tests, scripts): the cron is the drain.
  }
}
