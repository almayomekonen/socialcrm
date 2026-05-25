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

  // 1. Environment guard
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

  // 2. Read raw body, then parse.
  //
  //    Parsed BEFORE authentication because Grow PaymentLinks puts its
  //    (optional) authentication key in the request BODY, not in an HTTP
  //    header. Production captures of real deliveries confirmed that Grow
  //    sends no auth-related HTTP header (no x-grow-*, no webhook-key,
  //    no authorization). The previous header-based check rejected every
  //    delivery with 401.
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

  // 4. Optional body-key authentication.
  //
  //    Per Grow docs: the older 6 webhook formats include a `webhookKey`
  //    (camelCase) or `webhook_key` (snake_case) field in the body for
  //    static-secret auth. The newer PaymentLinks payload example does
  //    NOT include this field — for that variant Grow relies on URL
  //    secrecy (the merchant-configured webhook URL is the secret).
  //
  //    Strategy: if the payload contains a webhook key, validate it
  //    against GROW_WEBHOOK_SECRET. If not, allow the request through
  //    — the per-request `verifyToken(externalId)` at step 6 is the
  //    integrity check that binds this webhook to a specific agency
  //    (an attacker who knows the URL still can't forge a valid
  //    external_id without GROW_TOKEN_SECRET).
  const webhookKey: unknown = payload?.webhookKey ?? payload?.webhook_key
  if (webhookKey) {
    const secret = process.env.GROW_WEBHOOK_SECRET
    if (!secret) {
      console.error('[GrowWebhook] payload has webhookKey but GROW_WEBHOOK_SECRET is unset', {
        env: envInfo.env,
      })
      return new NextResponse('Server misconfigured', { status: 500 })
    }
    if (typeof webhookKey !== 'string' || !safeEqual(webhookKey, secret)) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  // Field-name tolerance across Grow webhook formats:
  //
  //   transactionId  ← `transactionId`  (docs example, legacy)
  //                    `transactionCode` (real PaymentLinks production payload)
  //
  //   externalId     ← `externalId`     (our convention if Grow echoes camelCase)
  //                    `external_id`    (legacy snake_case)
  //                    `identifyParam`  (real PaymentLinks production payload)
  //
  // Real-production captures showed `transactionCode` + `identifyParam`;
  // we keep the older names as primary so legacy formats continue to work.
  const transactionId: unknown = payload?.transactionId ?? payload?.transactionCode
  const externalId: unknown = payload?.externalId ?? payload?.external_id ?? payload?.identifyParam

  // 5. Required-fields gate.
  if (typeof transactionId !== 'string' || !transactionId || typeof externalId !== 'string' || !externalId) {
    return new NextResponse('Missing fields', { status: 400 })
  }

  console.log('[GrowWebhook] processing transaction:', transactionId)

  // 6. Verify token → agencyId.
  //
  //    `external_id` is an HMAC-signed payload we attached to the outbound
  //    payment URL. Grow echoes it back; we verify the signature against
  //    GROW_TOKEN_SECRET. A forged external_id fails this check. This is
  //    the primary integrity binding between a Grow webhook and an agency,
  //    independent of the optional body-key check above.
  let agencyId: number
  try {
    agencyId = verifyToken(externalId).agencyId
  } catch {
    return new NextResponse('Invalid token', { status: 400 })
  }

  // 7. Idempotent: insert payment + upgrade in one transaction.
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
