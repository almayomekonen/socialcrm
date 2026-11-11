import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { sweepQuotePdfs } from '@/lib/waAssistant/quotes/pdfSweep'
import { sweepSmartbeeDocuments } from '@/lib/waAssistant/smartbee/follow'

/**
 * WhatsApp assistant, every minute: the backstop drain for jobs the webhook's
 * `after()` kick did not finish, plus the lease reaper and the 24-hour text
 * purge, the quote-PDF recovery sweep and the SmartBee document sweep. Inert without the platform number and token, and nothing is queued
 * unless WA_ASSISTANT_AGENCY_IDS names an agency (lib/flags/waAssistantFlags.ts).
 */
export const maxDuration = 60

function authorized(req: NextRequest, secret: string): boolean {
  const given = req.headers.get('authorization') ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[WaAssistant][cron] CRON_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!authorized(req, secret)) return new NextResponse('Forbidden', { status: 403 })
  try {
    const summary = await runWaAssistantWorker()
    if (summary.claimed || summary.reaped) console.log('[WaAssistant][cron]', summary)
    // Quote PDFs the after() job did not finish. Only on a tick with no job, so a render never shares this function's 60 seconds with an Agent run.
    if (!summary.disabled && !summary.claimed) await sweepQuotePdfs().catch((e) => console.error('[WaAssistant][cron] quote pdf sweep failed', { name: (e as Error)?.name ?? null }))
    // SmartBee documents not yet confirmed or not yet reported to the owner. Inert unless SMARTBEE_AGENCY_IDS names an agency.
    if (!summary.disabled && !summary.claimed) await sweepSmartbeeDocuments().catch((e) => console.error('[WaAssistant][cron] smartbee sweep failed', { name: (e as Error)?.name ?? null }))
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    console.error('[WaAssistant][cron] failed', { name: (err as Error)?.name ?? null })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
