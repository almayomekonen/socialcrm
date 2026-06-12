import { NextRequest, NextResponse } from 'next/server'
import { requireUser, AuthError } from '@/lib/requireUser'
import { getUpgradeLink, isAnnualLinkConfigured } from '@/lib/payments/link'
import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import type { BillingPeriod } from '@/lib/pricing'

type AppEnv = 'local' | 'staging' | 'test' | 'production'
type GrowMode = 'sandbox' | 'production'

function isAppEnv(value: string | undefined): value is AppEnv {
  return value === 'local' || value === 'staging' || value === 'test' || value === 'production'
}

function isGrowMode(value: string | undefined): value is GrowMode {
  return value === 'sandbox' || value === 'production'
}

function assertPaymentEnv(host: string): { isProd: boolean; env: AppEnv; mode: GrowMode } {
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

  return { isProd: ENV === 'production', env: ENV, mode: MODE }
}

export async function GET(req: NextRequest) {
  const host = req.headers.get('host') || ''
  console.log('💳 ENV CHECK:', {
    env: process.env.APP_ENV,
    mode: process.env.GROW_MODE,
    host,
  })

  let user: Awaited<ReturnType<typeof requireUser>>
  try {
    user = await requireUser()
  } catch (err) {
    if (err instanceof AuthError) {
      console.warn('[upgrade] auth failed', { reason: err.reason })
      const loginUrl = new URL('/auth', req.url)
      loginUrl.searchParams.set('next', '/api/payments/upgrade')
      return NextResponse.redirect(loginUrl, 302)
    }
    console.error('[upgrade] unexpected auth error', { err: String(err) })
    return new NextResponse('Server error', { status: 500 })
  }

  // Billing period selection. Anything but an exact, configured 'annual'
  // resolves to monthly — and an unconfigured annual request bounces back to
  // billing rather than silently charging the monthly link (wrong-amount
  // charges are the one unforgivable failure).
  const rawPeriod = req.nextUrl.searchParams.get('period')
  if (rawPeriod === 'annual' && !isAnnualLinkConfigured()) {
    console.warn('[upgrade] annual requested but GROW_PAYMENT_LINK_ANNUAL is not configured', {
      agencyId: user.agencyId,
    })
    return NextResponse.redirect(new URL('/settings/update_payment', req.url), 302)
  }
  const period: BillingPeriod = rawPeriod === 'annual' ? 'annual' : 'monthly'

  // Intent metric, recorded before the env guard on purpose: a click is a
  // click regardless of environment outcome. track() never throws.
  const source = req.nextUrl.searchParams.get('source') ?? 'unknown'
  await track({ agencyId: user.agencyId, userId: user.id, event: 'upgrade_clicked', props: { source, period } })

  let envInfo: { isProd: boolean; env: AppEnv; mode: GrowMode }
  try {
    envInfo = assertPaymentEnv(host)
  } catch (err) {
    console.error('[upgrade] env guard tripped', { err: String(err) })
    return new NextResponse('Payments misconfigured', { status: 500 })
  }

  if (!envInfo.isProd) {
    console.warn('⚠️ Running outside production — redirecting to local payment settings', {
      env: envInfo.env,
      mode: envInfo.mode,
    })
    const localUrl = new URL('/settings/update_payment', req.url)
    localUrl.searchParams.set('mode', 'local')
    return NextResponse.redirect(localUrl, 302)
  }

  // Record the upgrade intent. Grow static Payment Links don't reliably
  // round-trip custom query params (identifyParam arrives empty in the
  // webhook); the webhook handler uses this row as a fallback ownership
  // resolver, looking up by payerEmail when externalId is empty.
  // Upsert on agencyId so re-clicks/refreshes don't pile up rows.
  const now = new Date()
  await db('pending_upgrades')
    .insert({
      agencyId: user.agencyId,
      email: user.email,
      status: 'pending',
      billingPeriod: period,
      createdAt: now,
      updatedAt: now,
    })
    .onConflict('agencyId')
    .merge({
      email: user.email,
      status: 'pending',
      billingPeriod: period,
      updatedAt: now,
    })

  try {
    const url = getUpgradeLink(user.agencyId, period)
    return NextResponse.redirect(url, 302)
  } catch (err) {
    console.error('[upgrade] link build failed', { agencyId: user.agencyId, err: String(err) })
    return new NextResponse('Payments not configured', { status: 500 })
  }
}
