import { signToken } from './token'

export function getUpgradeLink(agencyId: number): string {
  const base = process.env.GROW_PAYMENT_LINK
  if (!base) throw new Error('GROW_PAYMENT_LINK is not configured')

  const token = signToken(agencyId)
  const url = new URL(base)
  url.searchParams.set('external_id', token)
  return url.toString()
}
