/**
 * Shared harness for the Reminder Engine Phase 6 WhatsApp tests: a real local
 * test database, the REAL Action Runtime and the REAL webhook entry point. Only
 * the model and Meta's Graph API are mocked; nothing leaves the test database,
 * and every recipient, number and agency is synthetic.
 */
import { expect, vi } from 'vitest'
import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

let seq = 0
export const MIN = 60_000
export type Owner = { agencyId: number; u: number; r: number; digits: string }
export const ENV_KEYS = ['WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_REMINDERS_AGENCY_IDS', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_ACCESS_TOKEN', 'OWNER_PERSONAL_REMINDERS_SEND_ENABLED']

export async function agencies(...names: string[]) {
  return Promise.all(names.map((n) => agency(n)))
}

export async function owner(agencyId: number, consent = 'v5', role = 'ADMIN'): Promise<Owner> {
  const u = await user(agencyId, role)
  const digits = `9725000081${String(++seq).padStart(2, '0')}`
  return { agencyId, u, r: await recipient(agencyId, u, digits, undefined, consent), digits }
}

/** The assistant and the reminders switch on for `on`; the assistant only for `assistantOnly`. */
export function setEnv(on: number[], assistantOnly: number[] = []) {
  process.env.WA_ASSISTANT_AGENCY_IDS = [...on, ...assistantOnly].join(',')
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = [...on, ...assistantOnly].join(',')
  process.env.WA_ASSISTANT_REMINDERS_AGENCY_IDS = on.join(',')
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
  delete process.env.OWNER_PERSONAL_REMINDERS_SEND_ENABLED
}

export async function reset(agencyIds: number[]) {
  await db('owner_personal_reminder_events').whereIn('agencyId', agencyIds).del()
  await db('owner_personal_reminders').whereIn('agencyId', agencyIds).del()
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
  await resetBetweenTests()
  await db('agencies').whereIn('id', agencyIds).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
}

export async function teardown() {
  for (const k of ENV_KEYS) delete process.env[k]
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
  await cleanup()
}

/** A model that must not be asked: every reminder path is deterministic. */
export function harness() {
  const runAgent = vi.fn(async () => ({ ok: false as const, reason: 'should_not_run', costUsd: 0 }) as never)
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.RM_${++seq}` }))
  const deps = { runAgent: runAgent as never, sendText: sendText as never, typing: (async () => undefined) as never }
  const last = () => sendText.mock.calls.at(-1)![0] as { body: string; buttons?: { id: string; title: string }[]; toE164: string }
  return { runAgent, sendText, deps, last }
}
export type Harness = ReturnType<typeof harness>

export async function say(o: Owner, body: string, wamid = `wamid.__rm_${++seq}`) {
  return processPlatformMessage({ id: wamid, from: o.digits, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } })
}
export const tap = (o: Owner, buttonId: string) =>
  processPlatformMessage({
    id: `wamid.__rm_${++seq}`,
    from: o.digits,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'x' } },
  })
export const run = (h: Harness) => runWaAssistantWorker({}, h.deps)

/** Say something and return the one reply it produced. */
export async function ask(o: Owner, h: Harness, body: string) {
  expect(await say(o, body)).toBe('assistant_queued')
  const before = h.sendText.mock.calls.length
  await run(h)
  expect(h.sendText.mock.calls.length).toBe(before + 1)
  return h.last()
}

/** Ask for something that must produce a card; return its buttons. */
export async function card(o: Owner, h: Harness, body: string) {
  const sent = await ask(o, h, body)
  expect(sent.buttons, sent.body).toHaveLength(2)
  return { body: sent.body, approve: sent.buttons![0].id, reject: sent.buttons![1].id, titles: sent.buttons!.map((b) => b.title) }
}

export async function press(o: Owner, h: Harness, buttonId: string) {
  await tap(o, buttonId)
  await run(h)
  return h.last()
}

export const reminders = (o: Owner) => db('owner_personal_reminders').where({ agencyId: o.agencyId, userId: o.u }).orderBy('id')

/** The latest job of a recipient, in the shape the worker hands to the reminder layer. */
export async function lastJob(o: Owner): Promise<WaAssistantJob> {
  const r = (await db('wa_assistant_jobs').where({ recipientId: o.r }).orderBy('id', 'desc').first()) as Record<string, unknown>
  return {
    id: Number(r.id), wamid: String(r.wamid), recipientId: Number(r.recipientId), agencyId: Number(r.agencyId), userId: Number(r.userId),
    kind: r.kind as WaAssistantJob['kind'], question: r.question as string, messageTimestamp: Number(r.messageTimestamp),
    timestampSource: (r.timestampSource as 'meta' | 'server' | null) ?? null, attempts: Number(r.attempts ?? 0),
  } as WaAssistantJob
}
