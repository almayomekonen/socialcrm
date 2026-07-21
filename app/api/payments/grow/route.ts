import { NextRequest, NextResponse, after } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/config/db'
import { verifyToken } from '@/lib/payments/token'
import { performAgencyUpgrade } from '@/lib/quota/performUpgrade'
import { track } from '@/lib/analytics/track'
import { dispatchLifecycleEvent } from '@/lib/emailAutomations/live'
import { agencyOwner } from '@/lib/emailAutomations/recipients'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState } from '@/lib/trial'
import { resolveBillingPeriod, logPeriodResolution, type PeriodResolution } from '@/lib/payments/resolvePeriod'

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
    webhookKey: webhookKey ? 'present' : 'absent',
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
    const rawEmail = payload?.payerEmail ?? payload?.payer_email ?? payload?.email
    const payerEmail = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''

    let pending = payerEmail
      ? await db('pending_upgrades')
          .whereRaw('lower(email) = ?', [payerEmail])
          .where({ status: 'pending' })
          .orderBy('createdAt', 'desc')
          .first()
      : null

    // Grow checkout doesn't always collect the payer's email (observed in
    // production: real transactions arrive with an empty email field). When
    // email can't resolve ownership but exactly ONE pending upgrade exists,
    // attribution is unambiguous — use it.
    if (!pending) {
      const candidates = await db('pending_upgrades').where({ status: 'pending' })
      if (candidates.length === 1) {
        pending = candidates[0]
        console.warn('[GrowWebhook] email lookup failed; using sole pending row', {
          payerEmail,
          agencyId: pending.agencyId,
        })
      }
    }

    if (!pending) {
      console.error('[GrowWebhook] no pending upgrade resolved', { payerEmail })
      return new NextResponse('Pending upgrade not found', { status: 404 })
    }
    agencyId = pending.agencyId
  }

  // Captured BEFORE the upgrade flips plan to 'pro', so the analytics event
  // records which state the agency converted from. Read failure must never
  // block a payment — default to 'unknown'.
  let fromState = 'unknown'
  try {
    const trialRow = await getAgencyTrial(agencyId)
    if (trialRow) fromState = getTrialState(trialRow, new Date()).status
  } catch {}

  // Billing-period classification (5-rule chain, lib/payments/resolvePeriod).
  // Safety requirement: never fail the payment, never block access, never
  // throw — a resolution failure grants monthly and logs loudly.
  let resolution: PeriodResolution = {
    period: 'monthly',
    resolvedBy: 'fallback',
    candidates: { payment_link_id: null, amount: null, pending_upgrade: null, existing_subscription: null },
  }
  try {
    resolution = await resolveBillingPeriod(agencyId, payload)
  } catch (err) {
    console.error('[GrowWebhook] period resolution crashed — defaulting to monthly', {
      agencyId,
      transactionId,
      err: String(err),
    })
  }
  try {
    logPeriodResolution({ agencyId, transactionId, payload }, resolution)
  } catch {}

  console.log('[GrowWebhook] before transaction')
  try {
    await db.transaction(async (trx) => {
      await trx('payments').insert({ transactionId, agencyId })
      const result = await performAgencyUpgrade(agencyId, `grow:${transactionId}`, trx, resolution.period)
      if ('error' in result) throw new Error(`upgrade_failed:${result.error}`)
    })
  } catch (err: any) {
    if (err?.code === PG_UNIQUE_VIOLATION) {
      return NextResponse.json({ ok: true, duplicate: true })
    }
    console.error('[GrowWebhook] processing failed', { transactionId, agencyId, err: String(err) })
    return new NextResponse('Processing error', { status: 500 })
  }

  // Post-commit on purpose: an analytics failure must never roll back a
  // payment. track() also never throws.
  await track({
    agencyId,
    event: 'subscription_activated',
    props: { transactionId, fromState, period: resolution.period, periodResolvedBy: resolution.resolvedBy },
  })

  // After successful upgrade, mark the pending entry as completed.
  // Uses `db` (not `trx`) — runs after the upgrade transaction commits.
  // Non-atomic with the upgrade by design; if this UPDATE fails, the
  // upgrade still stands and pending stays 'pending' (recoverable, harmless
  // since the next webhook for this agency would also succeed).
  await db('pending_upgrades').where({ agencyId }).update({
    status: 'completed',
    updatedAt: new Date(),
  })

  // Thank-you email for the FIRST activation. Dispatched only here — after the
  // upgrade transaction has committed — so an email can never imply a payment
  // that did not land. Deferred with after() so Resend latency never delays the
  // webhook response, and fully guarded: an email failure must not fail a paid
  // transaction. Renewals re-enter this path with a new transactionId, but the
  // engine's per-user claim is already taken, so the dispatcher skips them.
  after(async () => {
    try {
      const recipient = await agencyOwner(agencyId)
      if (!recipient) {
        console.warn('[GrowWebhook] subscription.activated: no owner resolved', { agencyId })
        return
      }
      await dispatchLifecycleEvent('subscription.activated', recipient, new Date())
    } catch (err) {
      console.error('[GrowWebhook] subscription.activated dispatch failed', { agencyId, err: String(err) })
    }
  })

  return NextResponse.json({ ok: true })
}
