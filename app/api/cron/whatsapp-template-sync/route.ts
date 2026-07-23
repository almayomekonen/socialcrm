import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/config/db'
import { reconcileWabaTemplates } from '@/lib/whatsapp/templates/sync'

/**
 * Reconciliation cron — the backstop for missed template webhooks. Walks every
 * connection that has a WABA id, lists its templates from Meta, and upserts them
 * locally (idempotent). CRON_SECRET-gated. Reads Meta, writes local rows; never
 * sends a message or triggers automation. Separate responsibility from the
 * webhook (real-time) and the client poll (DB-only).
 */

export const maxDuration = 60

function isAuthorized(req: NextRequest, secret: string): boolean {
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  if (req.headers.get('x-cron-secret') === secret) return true
  return false
}

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[template-sync] CRON_SECRET is not set')
    return new NextResponse('Internal Server Error', { status: 500 })
  }
  if (!isAuthorized(req, secret)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const connections = (await db('whatsapp_connections')
    .whereNotNull('waba_id')
    .select('agency_id', 'waba_id', 'access_token')) as {
    agency_id: number
    waba_id: string
    access_token: string
  }[]

  let scanned = 0
  let upserted = 0
  for (const c of connections) {
    try {
      const r = await reconcileWabaTemplates({ agencyId: c.agency_id, wabaId: c.waba_id, accessToken: c.access_token })
      scanned += r.scanned
      upserted += r.upserted
    } catch (err) {
      console.error('[template-sync] reconcile failed', { wabaId: c.waba_id, error: String(err) })
    }
  }

  console.log(`[template-sync] done connections=${connections.length} scanned=${scanned} upserted=${upserted}`)
  return NextResponse.json({ ok: true, connections: connections.length, scanned, upserted })
}

export async function GET(req: NextRequest) {
  return handle(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}
