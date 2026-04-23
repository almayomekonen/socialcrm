import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/config/db'
import { verifyToken } from '@/lib/payments/token'
import { performAgencyUpgrade } from '@/lib/quota/performUpgrade'

const PG_UNIQUE_VIOLATION = '23505'

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export async function POST(req: NextRequest) {
  // 1. Authenticity — shared-secret header check
  const secret = process.env.GROW_WEBHOOK_SECRET
  if (!secret) return new NextResponse('Server misconfigured', { status: 500 })

  const sig = req.headers.get('x-grow-signature')
  if (!sig || !safeEqual(sig, secret)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // 2. Read raw body, then parse
  const raw = await req.text()
  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 })
  }

  // 3. Defensive payload extraction (supports nested { data: {...} })
  const payload = body?.data ?? body
  const transactionId: unknown = payload?.transactionId
  const status: unknown = payload?.status
  const externalId: unknown = payload?.external_id

  // 4. Ignore non-success events idempotently
  if (status !== 'success') {
    return NextResponse.json({ ok: true, ignored: true })
  }

  if (typeof transactionId !== 'string' || !transactionId || typeof externalId !== 'string' || !externalId) {
    return new NextResponse('Missing fields', { status: 400 })
  }

  // 5. Verify token → agencyId
  let agencyId: number
  try {
    agencyId = verifyToken(externalId).agencyId
  } catch {
    return new NextResponse('Invalid token', { status: 400 })
  }

  // 6. Idempotent: insert payment + upgrade in one transaction.
  //    Unique (transactionId) makes replay a no-op.
  try {
    await db.transaction(async (trx) => {
      await trx('payments').insert({ transactionId, agencyId })
      const result = await performAgencyUpgrade(agencyId, `grow:${transactionId}`, trx)
      if ('error' in result) throw new Error(`upgrade_failed:${result.error}`)
    })
  } catch (err: any) {
    if (err?.code === PG_UNIQUE_VIOLATION) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    console.error('[GrowWebhook] processing failed', { transactionId, agencyId, err: String(err) })
    return new NextResponse('Processing error', { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
