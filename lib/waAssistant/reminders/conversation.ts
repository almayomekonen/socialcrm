import 'server-only'
import { db } from '@/config/db'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { reminderIntent, type ReminderIntent } from '@/lib/reminders/request'
import { opensRequest } from '../continuation'

/**
 * ONE personal-reminder request, over the owner's messages (Phase 6).
 *
 * A message is part of a reminder request when it opens one (lib/reminders/
 * request.ts), or when it answers the question we asked about one: the previous
 * job of THIS recipient stopped with `reminder_clarify_<op>_<ask>` less than 15
 * minutes earlier. A message that opens a different request (a meeting, a task)
 * starts clean, like everywhere else in the assistant. The task/meeting
 * continuation (../request.ts) is not touched: its questions carry their own
 * stop reasons, so the two never read each other's.
 *
 * Each message carries its own Meta timestamp and provenance, so the caller can
 * anchor the time on the message that actually said it.
 */

export const REMINDER_CLARIFY = 'reminder_clarify_'
const WINDOW_MS = 15 * 60 * 1000
const MAX_MESSAGES = 5

export type ReminderMessage = { text: string; wamid: string; ts: number; source: 'meta' | 'server' | null; asked: string | null }
export type ReminderRequest = { op: ReminderIntent; messages: ReminderMessage[] }

type Row = { id: number; kind: string; question: string | null; stopReason: string | null; createdAt: Date; wamid: string; messageTimestamp: string | number; timestampSource: 'meta' | 'server' | null }

/** `reminder_clarify_cancel_target` → 'cancel'. */
function opOf(stopReason: string): ReminderIntent | null {
  const op = stopReason.slice(REMINDER_CLARIFY.length).split('_')[0]
  return op === 'create' || op === 'cancel' || op === 'reschedule' ? op : null
}

export async function readReminderRequest(job: WaAssistantJob): Promise<ReminderRequest | null> {
  const text = job.question?.trim() ?? ''
  if (!text) return null
  const current = (asked: string | null): ReminderMessage => ({ text, wamid: job.wamid, ts: job.messageTimestamp, source: job.timestampSource ?? null, asked })
  const intent = reminderIntent(text)
  if (intent) return { op: intent, messages: [current(null)] }
  if (opensRequest(text)) return null

  const rows = (await db('wa_assistant_jobs')
    .where({ recipientId: job.recipientId })
    .where('id', '<', job.id)
    .orderBy('id', 'desc')
    .limit(MAX_MESSAGES)
    .select('id', 'kind', 'question', 'stopReason', 'createdAt', 'wamid', 'messageTimestamp', 'timestampSource')) as Row[]
  const chain: Row[] = []
  let next = Date.now()
  const selfRow = (await db('wa_assistant_jobs').where({ id: job.id }).first('createdAt')) as { createdAt: Date } | undefined
  if (selfRow) next = new Date(selfRow.createdAt).getTime()
  for (const r of rows) {
    const at = new Date(r.createdAt).getTime()
    if (r.kind !== 'text' || !r.question || next - at > WINDOW_MS || !r.stopReason?.startsWith(REMINDER_CLARIFY)) break
    chain.push(r)
    next = at
    if (reminderIntent(r.question)) break
  }
  if (!chain.length) return null
  const ordered = chain.reverse()
  const op = reminderIntent(ordered[0].question!) ?? opOf(ordered[0].stopReason!)
  if (!op || op === 'list') return null
  const messages: ReminderMessage[] = ordered.map((r, i) => ({
    text: r.question!.trim(),
    wamid: r.wamid,
    ts: Number(r.messageTimestamp),
    source: r.timestampSource ?? null,
    asked: i === 0 ? null : ordered[i - 1].stopReason,
  }))
  messages.push(current(ordered[ordered.length - 1].stopReason))
  return { op, messages }
}
