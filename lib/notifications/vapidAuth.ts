/**
 * VAPID credentials for signing outbound push — P3.2.
 * Status reporting stays in getVapidConfig(); this only returns usable keys.
 */

import { getVapidConfig } from './vapid'

export type VapidAuth = {
  publicKey: string
  privateKey: string
  subject: string
}

export function getVapidAuth(): VapidAuth | null {
  if (getVapidConfig().status !== 'configured') return null
  const publicKey = (process.env.VAPID_PUBLIC_KEY ?? '').trim()
  const privateKey = (process.env.VAPID_PRIVATE_KEY ?? '').trim()
  const subject = (process.env.VAPID_SUBJECT ?? '').trim()
  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}
