/**
 * Facebook Page `feed` webhook — CANARY EXPERIMENT ONLY.
 *
 * Answers one question with real Meta traffic: when a user comments on a
 * connected Page's post, does the `feed` webhook payload carry populated
 * `comment_id`, `post_id`, `from` and `message` under the permissions we
 * ALREADY hold (`pages_show_list`, `pages_manage_metadata`) — i.e. without
 * `pages_read_user_content`?
 *
 * See docs/facebook-comments-feasibility-audit.md §C/§F.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO:
 *   - persist anything (no table, no migration, no row)
 *   - create or touch a Lead
 *   - emit an automation or lifecycle event
 *   - affect the leadgen path in any way
 *
 * It observes presence, never content. The whole point is to learn whether the
 * fields are POPULATED — collecting the actual comment text would be gathering
 * customer data for an experiment that does not need it. So the summary carries
 * booleans and a length, never the message, never the author id, never a raw
 * payload.
 *
 * FAIL-CLOSED: with `FACEBOOK_COMMENTS_CANARY_PAGE_ID` unset, or set to a
 * different Page, nothing is logged and nothing is processed. Every other
 * agency's Pages are untouched by construction.
 */

/** The single Page opted into the experiment, or null when the gate is off. */
export function getCanaryPageId(): string | null {
  const raw = process.env.FACEBOOK_COMMENTS_CANARY_PAGE_ID?.trim()
  return raw ? raw : null
}

/** Fail-closed: true only for an explicitly configured, exactly-matching Page. */
export function isCanaryPage(pageId: string | undefined | null): boolean {
  const canary = getCanaryPageId()
  return canary !== null && typeof pageId === 'string' && pageId === canary
}

/** Presence-only observation of one `feed` change. No customer content. */
export type FeedEventSummary = {
  pageId: string
  item: string | null
  verb: string | null
  commentIdPresent: boolean
  postIdPresent: boolean
  authorIdPresent: boolean
  authorNamePresent: boolean
  messagePresent: boolean
  messageLength: number
  createdTime: string | number | null
  parentIdPresent: boolean
}

/** Last 4 chars only — enough to tell Pages apart in a log, not an identifier. */
const maskPageId = (pageId: string) => `…${pageId.slice(-4)}`

const isFilled = (v: unknown): boolean => typeof v === 'string' && v.length > 0

/**
 * Reduce a `change.value` to presence flags. Total over any input — a malformed
 * or hostile payload yields a summary of `false`s rather than throwing, because
 * this runs inside a webhook that must never fail a sibling event.
 */
export function summarizeFeedChange(pageId: string, value: unknown): FeedEventSummary {
  const v = (value ?? {}) as Record<string, unknown>
  const from = (v.from ?? {}) as Record<string, unknown>
  const message = typeof v.message === 'string' ? v.message : ''
  const enumOf = (x: unknown) => (typeof x === 'string' ? x : null)

  return {
    pageId: maskPageId(pageId),
    item: enumOf(v.item),
    verb: enumOf(v.verb),
    commentIdPresent: isFilled(v.comment_id),
    postIdPresent: isFilled(v.post_id),
    // `from` is the field most likely to be withheld without
    // pages_read_user_content — it is the experiment's primary unknown.
    authorIdPresent: isFilled(from.id),
    authorNamePresent: isFilled(from.name),
    messagePresent: message.length > 0,
    messageLength: message.length,
    createdTime:
      typeof v.created_time === 'number' || typeof v.created_time === 'string' ? v.created_time : null,
    parentIdPresent: isFilled(v.parent_id),
  }
}

/**
 * Log one `feed` change if — and only if — it belongs to the canary Page.
 * Returns whether it was logged, so the webhook route can stay a one-liner and
 * tests can assert the gate without reading stdout.
 */
export function logCanaryFeedEvent(pageId: string | undefined | null, value: unknown): boolean {
  if (!isCanaryPage(pageId)) return false
  console.log('[FacebookCommentsCanary]', JSON.stringify(summarizeFeedChange(pageId as string, value)))
  return true
}
