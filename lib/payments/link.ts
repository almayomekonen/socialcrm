import { signToken } from './token'
import type { BillingPeriod } from '@/lib/pricing'

function getReturnUrl(): string {
  const ENV = process.env.APP_ENV
  const HOST = process.env.APP_HOST

  if (ENV === 'production' && !HOST) {
    throw new Error('Missing APP_HOST in production')
  }

  const baseUrl = ENV === 'production' ? `https://${HOST}` : 'http://localhost:3000'
  const returnUrl = `${baseUrl}/billing/success`

  console.log('🔁 Payment return_url:', returnUrl)

  return returnUrl
}

function linkEnvFor(period: BillingPeriod): string | undefined {
  return period === 'annual' ? process.env.GROW_PAYMENT_LINK_ANNUAL : process.env.GROW_PAYMENT_LINK
}

/** Gates every annual surface: UI option rendering and route validation. */
export function isAnnualLinkConfigured(): boolean {
  return Boolean(process.env.GROW_PAYMENT_LINK_ANNUAL)
}

export function getUpgradeLink(agencyId: number, period: BillingPeriod = 'monthly'): string {
  const base = linkEnvFor(period)
  // Never silently substitute the other link — a wrong-amount charge is the
  // one unforgivable failure. Callers must gate on isAnnualLinkConfigured().
  if (!base) throw new Error(`Grow payment link for '${period}' is not configured`)

  const token = signToken(agencyId)
  const url = new URL(base)
  // Grow PaymentLinks reads the merchant-defined identifier from a query
  // param named `identifyParam` (it echoes the same name in the webhook
  // response payload). The previous `external_id` name was silently
  // dropped by Grow's intake, producing `identifyParam: ""` in the
  // webhook and breaking signature verification downstream.
  url.searchParams.set('identifyParam', token)
  url.searchParams.set('return_url', getReturnUrl())

  return url.toString()
}

/**
 * Grow link URLs end in a base64-encoded numeric id
 * (…-MzI3ODc0Nw → 3278747). The webhook's period-resolution rule 1 matches
 * the payload's paymentLinkProcessId against these ids, derived from the
 * configured URLs so there is no separate config to drift. Returns null when
 * the URL doesn't decode to digits — rule 1 then abstains, never misclassifies.
 */
export function decodeGrowLinkId(linkUrl: string): string | null {
  try {
    const slug = new URL(linkUrl).pathname.split('/').pop() ?? ''
    const segment = slug.split('-').pop() ?? ''
    if (!segment) return null
    const decoded = Buffer.from(segment, 'base64').toString('utf8')
    return /^\d+$/.test(decoded) ? decoded : null
  } catch {
    return null
  }
}

/** Period ↔ link-id map for the webhook classifier, from configured envs only. */
export function getConfiguredLinkPeriodIds(): Array<{ period: BillingPeriod; linkId: string }> {
  const out: Array<{ period: BillingPeriod; linkId: string }> = []
  for (const period of ['monthly', 'annual'] as const) {
    const envUrl = linkEnvFor(period)
    if (!envUrl) continue
    const linkId = decodeGrowLinkId(envUrl)
    if (linkId) out.push({ period, linkId })
  }
  return out
}
