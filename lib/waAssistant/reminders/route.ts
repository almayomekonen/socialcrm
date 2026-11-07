import 'server-only'
import { db } from '@/config/db'
import { consentCoversPersonalReminders } from '@/lib/whatsapp/platform/consentText'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { readReminderRequest } from './conversation'
import { proposeReminder } from './create'
import { listReminders, proposeCancel, proposeReschedule } from './manage'
import type { ReminderDeps } from './reply'
import { REMINDER_COPY } from './copy'

/**
 * Personal reminders from the owner's WhatsApp (Reminder Engine Phase 6).
 *
 * Called by the worker for a text message, ONLY when the agency is on
 * WA_ASSISTANT_REMINDERS_AGENCY_IDS, after identity, product access and the
 * limits have passed. Returns null when the message is not a reminder request,
 * and the Agent answers it exactly as before.
 *
 * Deterministic, no model: the reminder actions are application-proposed
 * (SystemActionProposal), so their arguments come from rows and the owner's own
 * words, never from model output.
 *
 * CONSENT is read here only to answer kindly; every writer re-checks it under
 * the recipient lock (T0, T5, T6) and the send gate checks it again.
 */
export async function handleReminderMessage(input: { job: WaAssistantJob; scope: AgentScope; nowMs: number; deps?: ReminderDeps }): Promise<MeetingReply | null> {
  const { job, scope, nowMs } = input
  const req = await readReminderRequest(job)
  if (!req) return null
  const rec = (await db('owner_whatsapp_recipients')
    .where({ id: job.recipientId, agencyId: scope.agencyId, userId: scope.userId })
    .first('status', 'consentTextVersion')) as { status: string; consentTextVersion: string } | undefined
  const consentOk = !!rec && rec.status === 'active' && consentCoversPersonalReminders(rec.consentTextVersion)
  const common = { job, scope, req, consentOk, nowMs, deps: input.deps }
  switch (req.op) {
    case 'list':
      return listReminders({ scope, consentOk, nowMs })
    case 'capability':
      return { status: 'answered', stopReason: 'reminder_capability', text: consentOk ? REMINDER_COPY.capability : `${REMINDER_COPY.capability}\n\n${REMINDER_COPY.consent}`, headline: 'תזכורות אישיות' }
    case 'cancel':
      return proposeCancel(common)
    case 'reschedule':
      return proposeReschedule(common)
    case 'create':
      return proposeReminder({ job, scope, req, recipientConsentOk: consentOk, nowMs, deps: input.deps })
  }
}
