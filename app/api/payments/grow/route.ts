import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/config/db'
import { verifyToken } from '@/lib/payments/token'
import { performAgencyUpgrade } from '@/lib/quota/performUpgrade'

const PG_UNIQUE_VIOLATION = '23505'

type AppEnv = 'local' | 'staging' | 'test' | 'production'
type GrowMode = 'sandbox' | 'production'

function isAppEnv(value: string | undefined): value is AppEnv {
  return value === 'local' || value === 'staging' || value === 'test' || value === 'production'
}

function isGrowMode(value: string | undefined): value is GrowMode {
  return value === 'sandbox' || value === 'production'
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

function assertWebhookEnv(host: string): { env: AppEnv; mode: GrowMode } {
  const ENV = process.env.APP_ENV
  const MODE = process.env.GROW_MODE

  if (!isAppEnv(ENV)) {
    throw new Error('🚨 APP_ENV must be local, staging, test, or production')
  }
  if (!isGrowMode(MODE)) {
    throw new Error('🚨 GROW_MODE must be sandbox or production')
  }
  if (ENV === 'local' && MODE !== 'sandbox') {
    throw new Error('🚨 LOCAL must use sandbox payments')
  }
  if (ENV === 'staging' && MODE !== 'sandbox') {
    throw new Error('🚨 STAGING must use sandbox payments')
  }
  if (ENV === 'test' && MODE !== 'sandbox') {
    throw new Error('🚨 TEST must use sandbox payments')
  }
  if (ENV === 'production' && MODE !== 'production') {
    throw new Error('🚨 PROD must use real payments')
  }
  if (ENV === 'production') {
    const appHost = process.env.APP_HOST
    if (!appHost || !host.includes(appHost)) {
      throw new Error('🚨 Host mismatch in production')
    }
  }

  return { env: ENV, mode: MODE }
}

export async function POST(req: NextRequest) {
  const host = req.headers.get('host') || ''
  console.log('💳 ENV CHECK:', {
    env: process.env.APP_ENV,
    mode: process.env.GROW_MODE,
    host,
  })

  let envInfo: { env: AppEnv; mode: GrowMode }
  try {
    envInfo = assertWebhookEnv(host)
  } catch (err) {
    console.error('[GrowWebhook] env guard tripped', { err: String(err) })
    return new NextResponse('Webhook misconfigured', { status: 500 })
  }

  if (envInfo.env !== 'production') {
    console.warn('⚠️ Webhook blocked outside production')
    return new Response('Webhook disabled', { status: 400 })
  }

  // 1. Shared-secret configuration must be present for this environment.
  const secret = process.env.GROW_WEBHOOK_SECRET
  if (!secret) {
    console.error('[GrowWebhook] missing GROW_WEBHOOK_SECRET', { env: envInfo.env })
    return new NextResponse('Server misconfigured', { status: 500 })
  }

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

  // 3. Defensive payload extraction. Supports the nested { data: {...} } shape
  //    used by Grow PaymentLinks (the new "מערכת בנקאות חדשה") as well as
  //    flat legacy payloads from the older Grow business site.
  const payload = body?.data ?? body
  console.log('[GrowWebhook] payload keys:', Object.keys(payload || {}))

  const transactionId: unknown = payload?.transactionId
  // Grow PaymentLinks does not standardize on a casing for the echoed
  // external identifier. We send `external_id` on the outbound query string;
  // Grow may echo it back as either casing depending on the flow.
  const externalId: unknown = payload?.externalId ?? payload?.external_id

  // 4. Required-fields gate.
  //
  //    NOTE: we no longer gate on `payload.status === 'success'`. Real Grow
  //    PaymentLinks webhooks do not include a literal `'success'` value
  //    (see official docs: the `data.status` field carries values like
  //    'שולם' / 'statusCode: "2"', not the English string we used to expect).
  //    Gating on it was silently ignoring valid webhooks. Grow's webhook
  //    configuration is responsible for only firing on completed payments.
  if (typeof transactionId !== 'string' || !transactionId || typeof externalId !== 'string' || !externalId) {
    return new NextResponse('Missing fields', { status: 400 })
  }

  console.log('[GrowWebhook] processing transaction:', transactionId)

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
