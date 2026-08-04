import {
  claimAutomationJobs,
  completeAutomationJob,
  deadAutomationJob,
  failAutomationJob,
  reclaimStaleAutomationJobs,
  skipAutomationJob,
  type AutomationJob,
} from '@/db/automations/jobs'
import { claimSendOnce, confirmSendClaim, getSendClaimState, releaseSendClaim } from '@/db/automations/claims'
import {
  appendActivity,
  countAutomatedTodayForAgency,
  countAutomatedTodayForLead,
  hasConsumingActivity,
} from '@/db/automations/activity'
import { getDefinitionForWorker, type WorkerDefinition } from '@/db/automations/definitions'
import { getAgencyName, getLeadFacts, getRepName, type LeadFacts } from '@/db/automations/leadFacts'
import { getMeetingFacts } from '@/db/automations/meetingFacts'
import { isLeadSuppressed } from '@/db/automations/suppressions'
import { isRecipientBlocked } from './recipientBlocks'
import type { MeetingFacts } from './appointments'
import type { AnyActionExecutor } from './executors/types'
import type { ActionDefinition } from './catalog/types'
import { getAction } from './catalog/registry'
import { executorFor } from './executors/registry'
import { getAutomationsSendMode, type AutomationsSendMode } from './flags'

/**
 * THE WORKER'S DEPENDENCIES — the wiring, kept apart from the machine.
 *
 * Split out of worker.ts, which was over the file-size hard limit
 * (architecture-rules §1/§8). The seam is real: this file names every row reader,
 * transport and clock the engine touches, and worker.ts names none of them —
 * which is exactly the property that makes the state machine testable. It also
 * breaks the import cycle workerFacts.ts would otherwise have with worker.ts.
 */

export type WorkerDeps = {
  sendMode: () => AutomationsSendMode
  reclaim: (leaseMs: number) => Promise<number>
  claim: (workerId: string, limit: number) => Promise<AutomationJob[]>
  getDefinition: (id: number) => Promise<WorkerDefinition | null>
  getLeadFacts: (agencyId: number, leadId: number) => Promise<LeadFacts>
  isSuppressed: (agencyId: number, leadId: number) => Promise<boolean>
  /**
   * Whether a resolved recipient address is undeliverable. Keyed by the
   * subject field the address came from, so a future channel answers here
   * without the worker learning what the channel is.
   */
  isRecipientBlocked: (agencyId: number, fieldKey: string, address: string) => Promise<boolean>
  claimState: (automationId: number, leadId: number) => Promise<'none' | 'claimed' | 'confirmed'>
  claimOnce: (args: { agencyId: number; automationId: number; leadId: number; mode: 'live' | 'log' }) => Promise<boolean>
  confirmClaim: (automationId: number, leadId: number) => Promise<void>
  releaseClaim: (automationId: number, leadId: number) => Promise<void>
  hasEffect: (automationId: number, leadId: number) => Promise<boolean>
  countLeadToday: (agencyId: number, leadId: number, since: Date) => Promise<number>
  countAgencyToday: (agencyId: number, since: Date) => Promise<number>
  appendActivity: typeof appendActivity
  /** Subject-field resolution only. The sender identity is email's business. */
  agencyName: (agencyId: number) => Promise<string | null>
  repName: (userId: number | null) => Promise<string | null>
  /** The appointment occurrence's live state — read once per job, when relevant. */
  meetingFacts: (agencyId: number, meetingId: number) => Promise<MeetingFacts>
  /** Catalog lookup and executor lookup are injected like everything else, so
   *  the worker's independence from any particular action is testable. */
  getAction: (actionKey: string) => ActionDefinition | null
  executorFor: (actionKey: string) => AnyActionExecutor | null
  completeJob: (id: number) => Promise<void>
  skipJob: (id: number, reason: string) => Promise<void>
  failJob: (id: number, error: string) => Promise<void>
  deadJob: (id: number, error: string) => Promise<void>
  now: () => Date
}

export function defaultWorkerDeps(): WorkerDeps {
  return {
    sendMode: getAutomationsSendMode,
    reclaim: reclaimStaleAutomationJobs,
    claim: claimAutomationJobs,
    getDefinition: getDefinitionForWorker,
    getLeadFacts,
    isSuppressed: isLeadSuppressed,
    isRecipientBlocked,
    claimState: getSendClaimState,
    claimOnce: claimSendOnce,
    confirmClaim: confirmSendClaim,
    releaseClaim: releaseSendClaim,
    hasEffect: hasConsumingActivity,
    countLeadToday: countAutomatedTodayForLead,
    countAgencyToday: countAutomatedTodayForAgency,
    appendActivity,
    agencyName: getAgencyName,
    repName: getRepName,
    meetingFacts: getMeetingFacts,
    getAction,
    executorFor,
    completeJob: completeAutomationJob,
    skipJob: skipAutomationJob,
    failJob: failAutomationJob,
    deadJob: deadAutomationJob,
    now: () => new Date(),
  }
}
