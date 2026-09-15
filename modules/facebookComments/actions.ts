'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireAgencyUser } from '@/lib/requireUser'
import { upsertLead } from '@/actions/clients'
import { isFacebookCommentsEnabledForAgency } from '@/lib/facebook/comments/capability'

/**
 * Turn a Facebook comment into a ליד.
 *
 * LEAD CREATION PATH: the PUBLIC `upsertLead` action, not the server-internal
 * `insertLeadSystem`. This is a user-initiated write, and insertLeadSystem's
 * own header forbids exactly that — it bypasses quota and requireUser and is
 * reserved for signed, server-verified contexts like webhooks. Routing through
 * `upsertLead` inherits, for free and without duplication:
 *   · `requireProductAccess()` and the session's agencyId
 *   · `assertLeadQuota` inside `withAgencyQuotaLock` — a real transaction
 *   · the field allowlist (`CLIENT_WRITABLE_LEAD_FIELDS`)
 *   · origin coercion and the `lead_created` automation emit, in that same trx
 *
 * WHAT A COMMENT CAN HONESTLY BECOME: a name and a Facebook provenance string.
 * There is no phone and no email — `authorExternalId` is page-scoped and not
 * contactable — so the resulting ליד is real but must be worked through
 * Facebook. Nothing here invents contact details.
 *
 * ATOMICITY: `upsertLead` creates the ליד inside its own quota-lock
 * transaction. Linking the comment is a second statement, so a crash between
 * the two is possible. That gap is closed by RECOVERY rather than a wider
 * transaction (which would mean reimplementing `upsertLead` and forking the
 * Lead path): the global unique index on `clients."leadSource"` makes a second
 * ליד for the same comment impossible, so a retry finds the orphan and adopts
 * it. The invariant "one comment → at most one ליד" holds either way.
 */

export type ConvertResult =
  /** `created: false` — the comment was already linked to this ליד (an earlier or concurrent click). */
  | { ok: true; leadId: number; created: boolean }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'deleted'
        | 'page_authored'
        | 'not_enabled'
        | 'quota_exceeded'
        | 'create_failed'
        | 'db_error'
    }

/**
 * "דוד כהן" → first + last. A one-word or missing name has an EMPTY last name:
 * `clients."lastName"` is NOT NULL, so null would fail the insert for every
 * commenter whose Facebook name is a single word.
 */
function splitAuthorName(full: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: 'מגיב מפייסבוק', lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

export async function convertCommentToLead(commentId: string): Promise<ConvertResult> {
  try {
    // Tenancy comes from the session and nowhere else. `commentId` is the only
    // argument, so there is no agencyId or pageId for a caller to forge.
    const user = await requireAgencyUser()
    if (!isFacebookCommentsEnabledForAgency(user.agencyId)) return { ok: false, reason: 'not_enabled' }
    if (!commentId) return { ok: false, reason: 'not_found' }

    const leadSource = `facebook_comment:${commentId}`

    // Ownership check. `commentId` is a Meta-global identifier, so filtering by
    // it alone would be an IDOR — the agencyId predicate is load-bearing, and a
    // comment belonging to another agency is simply invisible here.
    const comment = await db('facebook_page_comments').where({ commentId, agencyId: user.agencyId }).first()
    if (!comment) return { ok: false, reason: 'not_found' }
    if (comment.status === 'deleted') return { ok: false, reason: 'deleted' }
    // The Page's own reply is the business talking, not a prospect.
    if (comment.authorIsPage) return { ok: false, reason: 'page_authored' }

    // Already converted — return the same ליד rather than making a second. The
    // refresh brings a stale tab's row up to date (it may still show "צור ליד").
    if (comment.convertedLeadId) {
      revalidatePath('/inbox/comments')
      return { ok: true, leadId: Number(comment.convertedLeadId), created: false }
    }

    const link = async (leadId: number) => {
      await db('facebook_page_comments')
        .where({ commentId, agencyId: user.agencyId })
        .update({ convertedLeadId: leadId, status: 'converted', updatedAt: new Date() })
    }

    // Recovery: an earlier attempt may have created the ליד and died before
    // linking. The unique index means we cannot create another, so adopt it.
    const findExisting = async () => {
      const row = await db('clients').where({ leadSource, agencyId: user.agencyId }).first()
      return row?.id ? Number(row.id) : null
    }
    const orphanId = await findExisting()
    if (orphanId) {
      await link(orphanId)
      revalidatePath('/inbox/comments')
      return { ok: true, leadId: orphanId, created: false }
    }

    const { firstName, lastName } = splitAuthorName(comment.authorName)

    // No idNum: `add_zeros_trigger` runs LPAD(idNum, 9, '0'), which TRUNCATES
    // anything longer, so any synthetic `FB_{id}` collapses to 9 characters and
    // collides on clients_idNum_agencyId_unique. Omitting it leaves NULL, which
    // is correct and is the norm for leads with no national id.
    // VISIBILITY: `status` and `userId` are set explicitly. Left out, the column
    // defaults win — `clients.status` defaults to the legacy string 'true' and
    // `userId` to NULL — and such a ליד matches no status tab in לידים and no
    // rep's permission filter: created, linked, and impossible to find
    // (production, 2026-09-15). Same values as every other intake path.
    const lead = await upsertLead(
      user.id,
      { firstName, lastName, leadSource, lead: true, status: 'new', userId: user.id, handlerId: user.id },
      undefined,
      true,
      'manual',
    )

    // No id means no ליד from THIS call: quota, entitlement or a DB error (upsertLead
    // catches those and returns `{ err }` / `{ error }`). A concurrent click may have
    // created this comment's ליד first — the unique leadSource index refuses ours, or
    // its insert used the last quota slot — so adopt that one before reporting failure.
    // Never link without an id: that would mark the comment converted with no ליד.
    if (!lead || typeof lead !== 'object' || !('id' in lead) || lead.id == null) {
      const concurrentId = await findExisting()
      if (concurrentId) {
        await link(concurrentId)
        revalidatePath('/inbox/comments')
        return { ok: true, leadId: concurrentId, created: false }
      }
      const quota = typeof lead === 'object' && lead !== null && 'error' in lead && lead.error === 'quota_exceeded'
      return { ok: false, reason: quota ? 'quota_exceeded' : 'create_failed' }
    }

    await link(Number(lead.id))
    revalidatePath('/inbox/comments')
    return { ok: true, leadId: Number(lead.id), created: true }
  } catch (err) {
    // Never surface a raw error to the client (frontend-experience §5).
    console.error('[FacebookComments] convertCommentToLead failed:', err)
    return { ok: false, reason: 'db_error' }
  }
}
