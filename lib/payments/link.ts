import { signToken } from './token'

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

export function getUpgradeLink(agencyId: number): string {
  const base = process.env.GROW_PAYMENT_LINK
  if (!base) throw new Error('GROW_PAYMENT_LINK is not configured')

  const token = signToken(agencyId)
  const url = new URL(base)
  // Grow PaymentLinks reads the merchant-defined identifier from a query
  // param named `identifyParam` (it echoes the same name in the webhook
  // response payload). The previous `external_id` name was silently
  // dropped by Grow's intake, producing `identifyParam: ""` in the
  // webhook and breaking signature verification downstream.
  url.searchParams.set('identifyParam', token)
  url.searchParams.set('return_url', getReturnUrl())

  // TEMP DEBUG — remove once next real Grow delivery confirms the URL
  // shape Grow received. Lets us see whether the deployment is actually
  // running ec9500d9 (identifyParam) vs. the prior code (external_id).
  console.log('[GrowLink] generated URL:', url.toString())

  return url.toString()
}
