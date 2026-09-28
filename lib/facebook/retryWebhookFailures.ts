import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { db } from '@/config/db'
import { parseFacebookLead } from '@/lib/adapters/facebookLead'
import { normalizeFormAnswers } from '@/lib/facebook/leadFormAnswers'
import { createLeadFromWebhook } from '@/lib/system/createClientFromWebhook'
import { fetchLeadWithTimeout } from '@/lib/facebook/leadNodeFetch'
import { buildLeadAttribution, leadSourceCandidates, LEAD_MINIMAL_GRAPH_FIELDS } from '@/lib/facebook/leadAttribution'
import { notifyFacebookIngestionFailed } from '@/lib/facebook/integrationNotifications'
import {
  claimDueFailures,
  markFailureDead,
  markFailureResolved,
  rescheduleFailure,
  setFailureAgency,
  type WebhookFailureRow,
} from '@/db/webhookFailures'
import {
  decideAfterAttempt,
  isRetryableFailure,
  shouldAlertOnTerminal,
  type AttemptOutcome,
} from '@/lib/facebook/webhookFailurePolicy'

/**
 * Recovery pass over failed Meta lead ingestion.
 *
 * THE PROBLEM IT SOLVES. Both webhooks answer 200 unconditionally so Meta never
 * redelivers, which turns every transient internal failure — a Graph 500, a
 * timeout, a database blip — into a permanently lost lead the customer paid for.
 * This is the retry Meta will not perform on our behalf.
 *
 * IT CANNOT DUPLICATE A LEAD. Three independent layers say so:
 *   1. it checks both `leadSource` candidates before doing any work;
 *   2. `createLeadFromWebhook` runs its own dedup ladder (leadSource, then phone);
 *   3. `clients_lead_source_unique` is the database's final word.
 * So a lead that arrived by some other route while a failure sat in the queue
 * resolves the row rather than creating a second copy.
 *
 * IT CANNOT HAMMER META. Claims are bounded per pass, spaced by an exponential
 * backoff, capped by an attempt budget, and rows whose token is dead are never
 * retried at all — a 401 cannot be fixed by repetition, only by a reconnect.
 *
 * ATTRIBUTION ON RECOVERY comes from the Graph node alone: the original webhook
 * body is not persisted, so `form_id`/`adgroup_id` are unavailable on this path.
 * That is a smaller record than a first-time ingest produces, and it is the
 * honest one — nothing here invents a value the retry could not observe.
 */

export type RetryResult = {
  claimed: number
  recovered: number
  alreadyExisted: number
  rescheduled: number
  dead: number
}

/** Bounded by default. The queue recovers leads gently; it never bursts. */
export const DEFAULT_RETRY_BATCH = 10

async function attemptOne(row: WebhookFailureRow): Promise<AttemptOutcome> {
  // A failure whose cause is a dead token can never succeed by repetition.
  if (!isRetryableFailure(row.error_type)) return { kind: 'needs_reconnect' }

  const connection = await db('facebook_pages').where({ page_id: row.page_id }).first()
  if (!connection) return { kind: 'no_connection' }

  // Backfill the tenant for rows written before agency_id existed, so the
  // operational view and any alert are correctly scoped from here on.
  if (row.agency_id == null && connection.agency_id) {
    await setFailureAgency(row.id, connection.agency_id).catch(() => {})
  }

  // Do not spend a Graph call against a connection already known to be dead.
  if (connection.health_status === 'token_expired') return { kind: 'needs_reconnect' }

  // Layer 1 of the no-duplicates guarantee.
  const existing = await db('clients').whereIn('leadSource', leadSourceCandidates(row.lead_id)).first()
  if (existing) return { kind: 'already_exists' }

  let res: Response
  let pageAccessToken: string
  try {
    pageAccessToken = resolvePageAccessToken(connection.page_access_token)
    res = await fetchLeadWithTimeout(row.lead_id, pageAccessToken)
  } catch (err) {
    return { kind: 'transient', error: String(err) }
  }

  // Same widened→minimal ladder as ingestion: attribution must never cost a lead.
  if (!res.ok && res.status !== 401 && res.status !== 403) {
    try {
      const minimal = await fetchLeadWithTimeout(row.lead_id, pageAccessToken, LEAD_MINIMAL_GRAPH_FIELDS)
      if (minimal.ok) res = minimal
    } catch {
      // Fall through to the status handling below.
    }
  }

  if (res.status === 401 || res.status === 403) return { kind: 'needs_reconnect' }
  if (!res.ok) return { kind: 'transient', error: `HTTP ${res.status}` }

  const node = await res.json().catch(() => null)
  if (!Array.isArray(node?.field_data) || node.field_data.length === 0) {
    // Meta accepted the read and returned no answers. Repetition will not add
    // any, so this is terminal rather than transient — but it is also not a
    // failure to recover from: there is no lead here to create.
    return { kind: 'no_connection' }
  }

  const { firstName, lastName, phone, email } = parseFacebookLead(node.field_data)
  const lead = await createLeadFromWebhook({
    firstName,
    lastName,
    phone,
    email,
    leadId: row.lead_id,
    agencyId: connection.agency_id,
    userId: connection.user_id,
    attribution: buildLeadAttribution({
      leadgenId: row.lead_id,
      pageId: row.page_id,
      webhookValue: null,
      graphNode: node,
    }),
    formAnswers: normalizeFormAnswers(node.field_data),
  })

  if (!lead) return { kind: 'transient', error: 'createLeadFromWebhook returned null' }
  return { kind: 'recovered' }
}

export async function runWebhookFailureRetry(limit: number = DEFAULT_RETRY_BATCH): Promise<RetryResult> {
  const result: RetryResult = { claimed: 0, recovered: 0, alreadyExisted: 0, rescheduled: 0, dead: 0 }

  const rows = await claimDueFailures(limit)
  result.claimed = rows.length

  for (const row of rows) {
    let outcome: AttemptOutcome
    try {
      outcome = await attemptOne(row)
    } catch (err) {
      // One poisoned row must never stop the pass.
      outcome = { kind: 'transient', error: String(err) }
    }

    const decision = decideAfterAttempt(outcome, row.attempts, row.max_attempts)
    const lastError = outcome.kind === 'transient' ? outcome.error : null

    try {
      if (decision.status === 'resolved') {
        await markFailureResolved(row.id, decision.resolution)
        if (decision.resolution === 'recovered') result.recovered++
        else result.alreadyExisted++
      } else if (decision.status === 'dead') {
        await markFailureDead(row.id, decision.resolution, lastError)
        result.dead++

        /**
         * The alert. ONLY when we exhausted a budget we believed could succeed —
         * a genuine "this lead is lost and a human should know". Connection
         * problems stay silent here because `integration.disconnected` already
         * says the same thing better; two alerts for one cause is the
         * notification fatigue the care charter forbids.
         */
        if (shouldAlertOnTerminal(decision.resolution) && row.agency_id != null) {
          await notifyFacebookIngestionFailed({ id: row.id, agency_id: row.agency_id, page_id: row.page_id }, row.lead_id).catch(
            () => {},
          )
        }
      } else {
        await rescheduleFailure(row.id, decision.attempts, decision.retryInSeconds, lastError)
        result.rescheduled++
      }
    } catch (err) {
      console.error('[webhookFailureRetry] write-back failed', { id: row.id, err: String(err) })
    }
  }

  console.log('[webhookFailureRetry] pass complete', result)
  return result
}
