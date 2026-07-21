import type { BillingPeriod } from '@/lib/pricing'

type PaymentLinkOverride = {
  email: string
  linkEnvVars: Partial<Record<BillingPeriod, string>>
}

const PAYMENT_LINK_OVERRIDES: readonly PaymentLinkOverride[] = [
  {
    email: 'ariel.dalal@gmail.com',
    linkEnvVars: {
      monthly: 'GROW_PAYMENT_LINK_OVERRIDE__ARIEL_DALAL',
      annual: 'GROW_PAYMENT_LINK_OVERRIDE__ARIEL_DALAL_ANNUAL',
    },
  },
]

export function getPaymentLinkOverride(email: string | null | undefined, period: BillingPeriod): string | null {
  if (!email) return null
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null

  const entry = PAYMENT_LINK_OVERRIDES.find((o) => o.email.toLowerCase() === normalized)
  const envVar = entry?.linkEnvVars[period]
  if (!envVar) return null

  const link = process.env[envVar]

  return typeof link === 'string' && link.trim() ? link : null
}
