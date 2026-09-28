import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { LeadFormAnswer } from '@/lib/facebook/leadFormAnswers'

/**
 * Lead form answers — data layer. Same contract as db/leadAttribution.ts:
 *
 * WRITE-ONCE PER SUBMISSION. One row per Meta leadgen id
 * (`lead_form_answers_submission_uniq`); the insert conflicts and is ignored,
 * so a redelivery or retry can neither duplicate nor overwrite what the first
 * delivery stored. A lead can hold several submissions (a second form, or one
 * that dedup matched to an existing lead); the newest is what is shown.
 *
 * NEVER THROWS on write. The answers are valuable but they are not the lead: a
 * failure is logged and swallowed inside a webhook that must answer 200.
 *
 * AGENCY SCOPE. `agencyId` comes from the verified Page's connection at write
 * time and is required on every read, so one agency can never read another's
 * answers.
 */

export async function recordLeadFormAnswers(
  row: { agencyId: number; leadId: number; leadgenId: string | null; answers: LeadFormAnswer[] },
  executor: Knex | Knex.Transaction = db,
): Promise<boolean> {
  if (!(row.agencyId > 0) || !(row.leadId > 0) || row.answers.length === 0) return false
  try {
    await executor('lead_form_answers')
      .insert({
        agencyId: row.agencyId,
        leadId: row.leadId,
        provider: 'meta',
        leadgenId: row.leadgenId,
        answers: JSON.stringify(row.answers),
      })
      .onConflict(['provider', 'leadgenId'])
      .ignore()
    return true
  } catch (err) {
    // Never log the answers themselves: they are the customer's words.
    console.error('[leadFormAnswers] write failed (swallowed)', {
      leadId: row.leadId,
      agencyId: row.agencyId,
      fields: row.answers.length,
      err: String(err),
    })
    return false
  }
}

/** One lead's newest stored answers, agency-scoped. Empty when none were stored. */
export async function formAnswersForLead(agencyId: number, leadId: number): Promise<LeadFormAnswer[]> {
  const row = await db('lead_form_answers')
    .where({ agencyId, leadId })
    .orderBy([{ column: 'createdAt', order: 'desc' }, { column: 'id', order: 'desc' }])
    .first('answers')
  const answers = typeof row?.answers === 'string' ? JSON.parse(row.answers) : row?.answers
  return Array.isArray(answers) ? (answers as LeadFormAnswer[]) : []
}
