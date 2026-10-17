import { ONE_OFF_AGENCY_ID } from '@/lib/ownerWhatsappReminders/oneOffSend'
import { SENDING_LEASE_MS } from '@/lib/ownerWhatsappReminders/constants'
import { tickOwnerWhatsappReminders } from '@/lib/ownerWhatsappReminders/tick'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { MIN, PLATFORM, TOKEN, ago, conversation, escalate, recipient, setLiveEnv, user } from './reminderFixtures'

/** Shared setup for the one-off test-send database tests (agency 103 only). */
const A = ONE_OFF_AGENCY_ID
let seq = 0

export function setOneOffEnv(recipientId: number) {
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = String(A)
  process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID = String(recipientId)
  delete process.env.OWNER_WA_REMINDERS_SEND_ENABLED
}

/** A due hand-off in agency 103 with one active ADMIN recipient. */
export async function dueHandoff(digits: string, opts: { escalatedAgo?: number; verifiedAt?: Date } = {}) {
  const admin = await user(A)
  const recipientId = await recipient(A, admin, digits, opts.verifiedAt)
  const c = await conversation(A, { lead: false })
  const escalatedAt = ago(opts.escalatedAgo ?? 121 * MIN)
  await escalate(c, escalatedAt)
  setOneOffEnv(recipientId)
  return { c, admin, recipientId, escalatedAt }
}

export const stop = (digits: string) =>
  processPlatformMessage({ id: `wamid.__owr_oneoff_stop_${++seq}`, from: digits, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'הסר' } })

/** The cron, live, after the sending lease expired: it must never send any of these. */
export async function liveCronLater() {
  setLiveEnv([A])
  return tickOwnerWhatsappReminders({ now: new Date(Date.now() + SENDING_LEASE_MS + MIN) })
}

export const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status })

