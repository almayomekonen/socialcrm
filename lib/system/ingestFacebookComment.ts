// SERVER-INTERNAL ONLY — called from the signature-verified Facebook webhook.
//
// TENANCY IS THE WHOLE POINT OF THIS MODULE. `agencyId` is resolved by looking
// up the Page id carried on the SIGNED webhook entry in `facebook_pages`. No
// field from the payload body is ever consulted for tenancy — a webhook body is
// attacker-influenced data, and `agency_id`/`agencyId`/`page_id` appearing in it
// mean nothing. This is what guarantees a comment on Agency A's Page can never
// surface for Agency B.
//
// NEVER THROWS. The webhook processes a batch of events in one delivery; a
// throw here would abort the request and strand sibling leadgen events, and
// Meta would then redeliver the whole batch. Every failure path returns a
// status instead.
//
// TASK 3 SCOPE: persistence only. No Lead is created here (that is Task 6), no
// Graph API call is made, and Lead Ads behaviour is untouched.

import { db } from '@/config/db'
import { parseFeedComment } from '@/lib/facebook/comments/parseFeedComment'
import { isFacebookCommentsEnabledForAgency } from '@/lib/facebook/comments/capability'

export type IngestResult = 'ingested' | 'deleted' | 'ignored'

/** Verbs that represent a live comment worth storing. */
const PERSISTABLE_VERBS = new Set(['add', 'edited'])

export async function ingestFacebookComment(pageId: string, value: unknown): Promise<IngestResult> {
  try {
    // Parse first: a non-comment feed item (production sent ten video/remove
    // events during the canary) is discarded before any query runs.
    const event = parseFeedComment(pageId, value)
    if (!event) return 'ignored'

    // ── Tenancy: resolved, never supplied. ────────────────────────────────
    const connection = await db('facebook_pages').where({ page_id: pageId }).first()
    if (!connection) {
      console.warn(`[FacebookComments] No connection for pageId=…${pageId.slice(-4)} — ignoring`)
      return 'ignored'
    }

    const agencyId: number = connection.agency_id
    if (!isFacebookCommentsEnabledForAgency(agencyId)) return 'ignored'

    // ── Deletion: mark, never hard-delete. ────────────────────────────────
    // A deletion may arrive for a comment we never stored (it predates the
    // rollout, or arrived while the agency was disabled). The update then
    // matches nothing, which is the correct no-op.
    if (event.verb === 'remove') {
      await db('facebook_page_comments')
        .where({ pageId, commentId: event.commentId })
        .update({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
      return 'deleted'
    }

    if (!PERSISTABLE_VERBS.has(event.verb)) return 'ignored'

    const now = new Date()
    const row = {
      agencyId,
      pageId,
      commentId: event.commentId,
      postId: event.postId,
      parentId: event.parentId,
      isTopLevel: event.isTopLevel,
      authorExternalId: event.authorId,
      authorName: event.authorName,
      message: event.message,
      messageAvailable: event.messageAvailable,
      verb: event.verb,
      createdTime: event.createdTime,
      receivedAt: now,
      updatedAt: now,
    }

    // ── Idempotency. ──────────────────────────────────────────────────────
    // Meta redelivers on any non-2xx, so duplicates are expected traffic, not
    // an error. The unique index on (pageId, commentId) IS the dedup mechanism.
    //
    // The conflict target is scoped to the page rather than commentId alone:
    // with a globally-unique key, a delivery naming page B could UPDATE a row
    // owned by page A's agency. Scoping to the page makes that cross-tenant
    // write unrepresentable.
    //
    // The merge set deliberately EXCLUDES agencyId and pageId — a redelivery
    // may refresh content, never ownership.
    await db('facebook_page_comments')
      .insert(row)
      .onConflict(['pageId', 'commentId'])
      .merge({
        message: row.message,
        messageAvailable: row.messageAvailable,
        authorName: row.authorName,
        verb: row.verb,
        updatedAt: row.updatedAt,
      })

    return 'ingested'
  } catch (err) {
    console.error('[FacebookComments] Ingest failed — ignoring:', err)
    return 'ignored'
  }
}
