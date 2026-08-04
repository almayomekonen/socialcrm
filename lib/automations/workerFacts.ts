import type { AutomationJob } from '@/db/automations/jobs'
import type { WorkerDefinition } from '@/db/automations/definitions'
import type { LeadFacts } from '@/db/automations/leadFacts'
import { MISSING_MEETING, meetingIdFromOccurrenceKey, type MeetingFacts } from './appointments'
import { getEvent } from './catalog/registry'
import { eventKeyForEngineTrigger } from './catalog/engineBridge'
import { liveFieldKeys } from './conditionEvaluator'
import type { Condition } from './conditions'
import type { SendFacts } from './laws'
import { recipientKeys, subjectResolver, type SubjectValues } from './subject'
import type { ActionDefinition } from './catalog/types'
import type { EventDefinition } from './catalog/types'
import type { AnyActionExecutor } from './executors/types'
import type { WorkerDeps } from './workerDeps'

/**
 * FACT GATHERING for one job — everything the worker reads before any law runs.
 *
 * Split out of worker.ts, which had crossed the file-size hard limit
 * (architecture-rules §1/§8: the touch is the trigger). The split is along a real
 * seam rather than a line count: worker.ts is the STATE MACHINE (claim → effect →
 * confirm → complete) and this is the READ that feeds it. Neither needs to hold
 * the other in mind.
 *
 * Still generic. Nothing here knows what an email is, and the one
 * event-specific read — the appointment's meeting — is named for the occurrence
 * rather than for any integration.
 */

/**
 * Everything the engine needs to know about the SUBJECT for one job, resolved
 * once and generically.
 *
 * Three consumers, one resolver: the live premise (whatever conditions the
 * automation declares), the action's recipients (whatever its `requires`
 * resolves to on this event), and the executor's variables (whatever it says
 * it can substitute). The worker names none of those fields — it forwards the
 * keys each consumer asks for and pays for exactly those.
 *
 * This is what makes `sms.send` a catalog entry plus an executor: it declares
 * `requires: ['phone']` and `resolvableFields`, and the lines below already
 * fetch both without knowing what SMS is.
 */
export async function resolveSubjectContext(
  job: AutomationJob,
  def: WorkerDefinition,
  lead: LeadFacts,
  action: ActionDefinition | null,
  executor: AnyActionExecutor | null,
  deps: WorkerDeps,
): Promise<{
  event: EventDefinition | null
  conditions: readonly Condition[]
  premise: SubjectValues
  subject: SubjectValues
  recipients: Record<string, string | null>
}> {
  const event = getEvent(eventKeyForEngineTrigger(job.trigger) ?? '')
  const conditions = def.conditions ?? []
  // The occurrence key is how the meeting's identity reaches the resolver:
  // `automation_jobs` carries no payload, so the dedup key is the only channel.
  const resolve = subjectResolver(job.agencyId, lead, deps, job.eventKey)

  const premiseKeys = event ? liveFieldKeys(event, conditions) : []
  const targetKeys = action ? recipientKeys(event, action.requires) : []
  const variableKeys = executor?.resolvableFields ?? []

  const premise = await resolve(premiseKeys)
  const subject = await resolve(variableKeys)
  const addresses = await resolve(targetKeys)

  const recipients: Record<string, string | null> = {}
  for (const key of targetKeys) {
    const value = addresses[key]
    recipients[key] = typeof value === 'string' && value.trim() ? value : null
  }

  return { event, conditions, premise, subject, recipients }
}

/**
 * The appointment occurrence's live state, for jobs that have one.
 *
 * Read here rather than inside the law layer because laws are pure. Null for
 * every other trigger, so nothing else pays for it. An appointment job whose key
 * names no meeting yields the missing-meeting state, which the guard fails
 * closed on — a reminder must never go out about a meeting we cannot read.
 */
export async function appointmentFactsFor(job: AutomationJob, deps: WorkerDeps): Promise<MeetingFacts | null> {
  if (job.trigger !== 'appointment_booked') return null
  const meetingId = meetingIdFromOccurrenceKey(job.eventKey)
  if (meetingId == null) return MISSING_MEETING
  return deps.meetingFacts(job.agencyId, meetingId)
}

/** Recipients as the law layer sees them: value plus deliverability. */
export async function recipientFacts(
  agencyId: number,
  recipients: Record<string, string | null>,
  deps: WorkerDeps,
): Promise<SendFacts['recipients']> {
  const out: SendFacts['recipients'] = {}
  for (const [key, value] of Object.entries(recipients)) {
    out[key] = { value, blocked: value ? await deps.isRecipientBlocked(agencyId, key, value) : false }
  }
  return out
}
