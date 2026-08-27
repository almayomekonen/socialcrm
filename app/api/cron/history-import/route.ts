import { NextRequest, NextResponse } from 'next/server'
import { getAutomationSecret, isAutomationAuthorized } from '@/lib/automation/apiAuth'
import { runHistoryImportWorker } from '@/lib/inbox/history/importWorker'
import { historyActivationState } from '@/lib/whatsapp/historyFlags'

export const maxDuration = 60

/**
 * The WhatsApp Coexistence history importer's scheduled wake-up.
 *
 * This route is ONLY an adapter: authenticate, then invoke the reusable worker.
 * It holds no claim logic, no retry policy and no scheduler-specific behaviour,
 * so the same work runs identically from a script or any other trigger. Vercel
 * Cron decides WHEN; Postgres decides what is durable. Nothing about correctness
 * depends on this handler completing — a run killed mid-drain leaves leased
 * deliveries that the next run reclaims, and the per-message
 * `(channel, externalId)` constraint turns replayed work into no-ops.
 *
 * `maxDuration = 60` is the repository convention for every cron route; the
 * worker's own 20s budget stops claiming well inside it so the response is
 * written before the platform intervenes. The per-invocation ceiling is 25
 * deliveries. There is no unbounded loop, and one request can never process an
 * entire archive.
 *
 * Auth is the shared automation secret (AUTOMATION_API_KEY / CRON_SECRET) via
 * `Authorization: Bearer`, `x-automation-key`, or `x-cron-secret` — the same
 * helper `signal-sweep` and `send-auto-responses` already use. There is no user,
 * no session and no agency in the request: the numbers whose history may be
 * processed come from the server's own allowlist, so a caller who holds the
 * secret still cannot choose whose archive is imported.
 *
 * IT DOES NOT BYPASS THE GATES. Processing requires
 * `WHATSAPP_HISTORY_PHONE_ALLOWLIST` to name the number; with the allowlist
 * empty this route claims nothing and touches no table. Requesting an archive
 * from Meta additionally requires `HISTORY_SYNC_ENABLED`, which this route
 * cannot influence at all — it never talks to Meta.
 *
 * THE RESPONSE CARRIES COUNTS ONLY. No wamid, no thread id, no phone number, no
 * message text, no raw payload — a cron response is an operational signal, not
 * a data channel, and this one crosses a network boundary.
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  const secret = getAutomationSecret()
  if (!secret) {
    console.error('[history-import] AUTOMATION_API_KEY / CRON_SECRET is not set')
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 })
  }
  if (!isAutomationAuthorized(req, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // A worker id that identifies the RUN, not a customer. Concurrent invocations
  // are safe regardless: FOR UPDATE SKIP LOCKED partitions the queue between
  // them, so two overlapping cron ticks never process the same delivery.
  const workerId = `cron-${process.env.VERCEL_DEPLOYMENT_ID ?? 'local'}-${Math.random().toString(36).slice(2, 10)}`
  const summary = await runHistoryImportWorker(workerId)

  return NextResponse.json({ ok: true, ...summary, activation: historyActivationState() })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req)
}
