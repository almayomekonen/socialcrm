import { NextRequest, NextResponse, after } from 'next/server'
import { track } from '@/lib/analytics/track'
import { notifyAgencyOwner } from '@/lib/payments/notifyOwner'
import { assertGrowRuntime } from '@/lib/payments/grow/config'
import { readGrowCallback, GrowCallbackError } from '@/lib/payments/grow/callbackPayload'
import { confirmCardSetup } from '@/lib/payments/cardTrial/confirmCardSetup'
import { verifyTokenSaveWithGrow } from '@/lib/payments/cardTrial/verifyTokenSave'
import { isGrowLocalMockEnabled, localMockVerifyTokenSave } from '@/lib/payments/grow/localMock'

/**
 * Grow server-to-server callback (notifyUrl) for card-token setup:
 * https://<APP_HOST>/api/payments/grow/notify
 *
 * DISTINCT FROM /api/payments/grow. That route receives Grow DASHBOARD webhooks
 * for Payment Links (JSON, webhookKey in the body). This one receives the Light
 * API callback: a form POST "NOT as JSON" with no documented secret,
 * authenticated inside confirmCardSetup (processToken + correlation) and
 * verified with Grow before anything changes.
 *
 * HTTP CONTRACT. 200 once the update is consumed — confirmed, already
 * processed, refused on its merits, or recorded while verification awaits
 * sandbox evidence (Grow's production review expects 200). 503 when we could
 * not decide and a retry can help. 400/401/413/415 for bodies that are not a
 * genuine update. No ApproveTransaction: Grow says not to send it for
 * save-token-only flows or token transactions.
 */

const LOG = '[GrowNotify]'

export async function POST(req: NextRequest) {
  // Local demo only: the mock stands in for the whole provider, verification
  // included. It fails closed off a developer machine, and it does not change
  // the provider-evidence gates that govern the real verifier.
  const mocked = isGrowLocalMockEnabled()
  let runtime: ReturnType<typeof assertGrowRuntime> = { env: 'staging', mode: 'sandbox' }
  try {
    if (!mocked) runtime = assertGrowRuntime()
  } catch (err) {
    console.error(`${LOG} runtime not allowed`, { err: String(err) })
    return new NextResponse('Service unavailable', { status: 503 })
  }

  let parsed: Awaited<ReturnType<typeof readGrowCallback>>
  try {
    parsed = await readGrowCallback(req)
  } catch (err) {
    const reason = err instanceof GrowCallbackError ? err.reason : 'unparseable'
    console.warn(`${LOG} body refused`, { reason, field: err instanceof GrowCallbackError ? err.field : null })
    if (reason === 'unsupported_encoding') return new NextResponse('Unsupported media type', { status: 415 })
    if (reason === 'too_large') return new NextResponse('Payload too large', { status: 413 })
    return new NextResponse('Bad request', { status: 400 })
  }
  // Key names and encoding only — never values (tokens live in them).
  console.log(`${LOG} received`, { encoding: parsed.encoding, keys: parsed.keys })

  let outcome: Awaited<ReturnType<typeof confirmCardSetup>>
  try {
    const verify = mocked ? localMockVerifyTokenSave : verifyTokenSaveWithGrow
    outcome = await confirmCardSetup(parsed.callback, { verify, runtimeMode: () => runtime.mode })
  } catch (err) {
    console.error(`${LOG} processing failed — Grow will retry`, { err: String(err) })
    return new NextResponse('Processing error', { status: 500 })
  }

  switch (outcome.kind) {
    case 'rejected':
      console.warn(`${LOG} rejected`, { reason: outcome.reason })
      return new NextResponse(outcome.httpStatus === 401 ? 'Unauthorized' : 'Bad request', { status: outcome.httpStatus })
    case 'retry_later':
      console.warn(`${LOG} verification unavailable — asking Grow to retry`, { agencyId: outcome.agencyId, reason: outcome.reason })
      return new NextResponse('Try again later', { status: 503 })
    case 'awaiting_evidence':
      console.warn(`${LOG} callback recorded; token-save verification disabled until sandbox evidence exists`, { agencyId: outcome.agencyId })
      return NextResponse.json({ ok: true, verified: false })
    case 'already_processed':
      return NextResponse.json({ ok: true, duplicate: true })
    case 'refused': {
      const { agencyId, reason } = outcome
      console.error(`${LOG} card not accepted`, { agencyId, reason })
      after(() => track({ agencyId, event: 'card_setup_failed', props: { stage: 'callback', reason } }))
      return NextResponse.json({ ok: true, confirmed: false })
    }
    case 'confirmed': {
      const confirmed = outcome
      after(async () => {
        await track({ agencyId: confirmed.agencyId, userId: confirmed.createdByUserId, event: 'card_setup_confirmed', props: { purpose: confirmed.purpose } })
        if (confirmed.trialStarted) {
          await track({ agencyId: confirmed.agencyId, userId: confirmed.createdByUserId, event: 'trial_started', props: { cardRequired: true } })
          // The card-trial activation email: states the exact first-charge date.
          // The click-to-start email ('trial.started', "no credit card needed")
          // is never dispatched for this path.
          await notifyAgencyOwner('trial.card_started', confirmed.agencyId, LOG)
        }
      })
      return NextResponse.json({ ok: true })
    }
  }
}
