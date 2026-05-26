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

  const raw = await req.text()
  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 })
  }

  const payload = body?.data ?? body
  console.log('[GrowWebhook] payload keys:', Object.keys(payload || {}))

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

  const transactionId: unknown = payload?.transactionId ?? payload?.transactionCode
  const externalId: unknown = payload?.externalId ?? payload?.external_id ?? payload?.identifyParam

  console.log('[GrowWebhook] resolved fields:', {
    webhookKey,
    transactionId,
    externalId,
  })

  // 5. Required-fields gate.
  // Required-fields gate. transactionId is non-negotiable (idempotency key
  // for the payments UNIQUE constraint). externalId is now allowed to be
  // empty so the pending_upgrades fallback (below) can resolve agencyId
  // by payerEmail when Grow doesn't echo our token back.
  if (typeof transactionId !== 'string' || !transactionId) {
    return new NextResponse('Missing fields', { status: 400 })
  }

  console.log('[GrowWebhook] processing transaction:', transactionId)

  // Resolve agencyId. Two paths:
  //   1) Existing token flow — externalId present → HMAC verify (unchanged)
  //   2) NEW fallback — externalId empty → look up most recent pending
  //      upgrade by payerEmail.
  let agencyId: number
  if (typeof externalId === 'string' && externalId.trim()) {
    try {
      agencyId = verifyToken(externalId).agencyId
      console.log('[GrowWebhook] token verified')
    } catch (err) {
      console.log('[GrowWebhook] token verification failed:', String(err))
      return new NextResponse('Invalid token', { status: 400 })
    }
  } else {
    console.log('[GrowWebhook] token missing, using pending lookup')
    const pending = await db('pending_upgrades')
      .where({ email: payload?.payerEmail, status: 'pending' })
      .orderBy('createdAt', 'desc')
      .first()
    if (!pending) {
      throw new Error('Pending upgrade not found')
    }
    agencyId = pending.agencyId
  }

  console.log('[GrowWebhook] before transaction')
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

  // After successful upgrade, mark the pending entry as completed.
  // Uses `db` (not `trx`) — runs after the upgrade transaction commits.
  // Non-atomic with the upgrade by design; if this UPDATE fails, the
  // upgrade still stands and pending stays 'pending' (recoverable, harmless
  // since the next webhook for this agency would also succeed).
  await db('pending_upgrades').where({ agencyId }).update({
    status: 'completed',
    updatedAt: new Date(),
  })

  return NextResponse.json({ ok: true })
}
