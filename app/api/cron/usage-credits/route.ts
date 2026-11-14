import { NextRequest, NextResponse } from 'next/server'
import { settleAgentRequests } from '@/db/credits/agentRequests'
import { creditPeriodKey } from '@/db/credits/ledger'
import { creditsMeasurementReport } from '@/db/credits/report'
import { isCreditsMeteringEnabled } from '@/lib/credits/config'
import { CREDIT_PACK_CHARGE_KINDS } from '@/db/payments/charges'
import { reconcileUnknownCharges, growChargeReconciler } from '@/lib/payments/charges/reconcileUnknown'

/** Unknown credit-pack outcomes reconciled per pass. */
const PACK_RECONCILE_LIMIT = 20

/**
 * Usage credits: settles quiet agent requests against ai_usage_events for each
 * agency's AI wallet (db/credits/ai.ts). Every 10 minutes. With
 * CREDITS_METERING unset it returns immediately and touches nothing.
 * WhatsApp credits need no cron: they are metered inside the send gate.
 */
export const maxDuration = 60

function isAuthorized(req: NextRequest, secret: string): boolean {
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return req.headers.get('x-cron-secret') === secret
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[usage-credits][cron] CRON_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAuthorized(req, secret)) return new NextResponse('Forbidden', { status: 403 })
  if (!isCreditsMeteringEnabled()) return NextResponse.json({ ok: true, metering: false })
  try {
    const summary = await settleAgentRequests()
    // A pack whose Grow answer was lost: resolved here (lookup only, never a new
    // charge), independent of the subscription charge pass. A failure here never
    // stops settlement.
    const packs = await reconcileUnknownCharges(PACK_RECONCILE_LIMIT, growChargeReconciler, { kinds: CREDIT_PACK_CHARGE_KINDS }).catch((err) => {
      console.error('[usage-credits][cron] pack reconciliation failed', { code: (err as { code?: string })?.code ?? null })
      return null
    })
    // Once an hour: internal totals only (no names, no message content).
    if (new Date().getMinutes() < 10) {
      const report = await creditsMeasurementReport(creditPeriodKey(Date.now()))
      console.log('[credits:report]', JSON.stringify(report))
      if (report.automation.overAlert) console.warn('[credits:report] automation AI spend is over its alert', { costUsd: report.automation.costUsd, alertUsd: report.automation.alertUsd })
      if (!report.reliable) console.warn('[credits:report] measurement incomplete: missing cost or unclassified AI usage', { unclassified: report.unclassified.kinds })
    }
    return NextResponse.json({ ok: true, metering: true, ...summary, packsReconciled: packs })
  } catch (err) {
    console.error('[usage-credits][cron] settlement failed', { code: (err as { code?: string })?.code ?? null })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
