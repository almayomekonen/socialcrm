import { NextResponse, after } from 'next/server'
import { processPlatformChanges } from './inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { platformBatchResponse, type WebhookSplit } from './webhookBatch'

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
  if (decision.useAgencyResponse && agencyResponse) return agencyResponse
  return NextResponse.json({ ok: decision.status < 300 }, { status: decision.status })
}

/**
 * Answer the owner right after Meta gets its 200, not on the next cron tick.
 * The job is already committed; if this cannot run (or fails), the minute-ly
 * /api/cron/wa-assistant drains it.
 */
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
