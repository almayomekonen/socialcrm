import { NextRequest, NextResponse } from 'next/server'
import { getAutomationSecret, isAutomationAuthorized } from '@/lib/automation/apiAuth'
import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import { expireStaleShadowReservations } from '@/db/aiBudget'
import { budgetPolicyFor, isAiBudgetShadowEnabled } from '@/lib/ai/budget/policy'
import { runQuestionnaireWorker } from '@/lib/inbox/autoresponse/questionnaire/worker'

export const maxDuration = 60

/**
 * Instant Response Engine drain. The WhatsApp webhook / promotion `after()`
 * kick waits approximately until notBefore (capped) then claims due jobs
 * (`pending` AND `notBefore <= now()`). This cron remains the scheduled
 * backstop when that kick is missed, the wait cap is shorter than delaySeconds,
 * or the function ends before the job is due. Idempotent with the kick via
 * SKIP LOCKED + the in-flight unique index.
 */
async function handle(req: NextRequest) {
  const secret = getAutomationSecret()
  if (!secret) {
    console.error('[send-auto-responses] AUTOMATION_API_KEY / CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  if (!isAutomationAuthorized(req, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const result = await runAutoResponseWorker()
  // Budget SHADOW recovery: reservations nobody settled (a worker died) are
  // charged their estimate. Simulation only; never touches a reply.
  if (isAiBudgetShadowEnabled()) {
    await expireStaleShadowReservations(new Date(), budgetPolicyFor(null).reservationTtlMinutes).catch((err) =>
      console.error('[ai-budget] shadow expiry failed', { name: (err as Error)?.name ?? 'error' }),
    )
  }
  // The second drain for the same table. Its claim takes only questionnaire
  // work, so the two never compete for a job. Isolated: a failure here must not
  // turn a successful agent drain into a 500 that the cron will retry.
  let questionnaire = { claimed: 0, sent: 0, skipped: 0, failed: 0 }
  try {
    questionnaire = await runQuestionnaireWorker()
  } catch (err) {
    console.error('[questionnaire] cron drain failed', { reason: (err as Error)?.message })
  }
  return NextResponse.json({ ok: true, ...result, questionnaire })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
