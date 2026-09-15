import { repairFacebookConnection } from '@/lib/facebook/health'

/**
 * Will Meta actually deliver this Page's Messenger events to SocialCRM?
 *
 * A recorded `pages_messaging` grant does not answer that, which was the whole of
 * the 2026-09-14 incident: Messenger was rolled out to the agency, the grant was
 * on the row, the tab said "no messages yet" — and the Page was subscribed to
 * `leadgen,feed` only, so Meta never sent a single message. Turning the rollout
 * on does not touch a Page; only connect, reconnect and repair do.
 *
 * So before the Messenger tab promises that messages will appear, it asks Meta,
 * through the same credential-free check-and-repair the hourly sweep runs
 * (`leadgen,feed` are always re-sent with the Messenger fields, so Lead Ads
 * cannot be unsubscribed by it).
 *
 * COST. Every Graph call spends the Page's rate limit, which Lead Ads intake
 * shares, and the empty tab refreshes every 10 seconds while visible. Answers
 * are cached per Page per server instance, one check runs at a time per Page,
 * and the render waits at most WAIT_MS — a slow Meta yields 'unknown' now and a
 * cached answer on a later refresh.
 *
 * This checks the PAGE half only. The app-level half (Meta dashboard) is logged
 * for operators by the hourly sweep; no customer can fix it.
 */
export type MessengerDelivery = 'ready' | 'not_subscribed' | 'reconnect' | 'unknown'

const SETTLED_TTL_MS = 5 * 60_000
/** A check that could not reach Meta says nothing about the Page; ask again soon. */
const UNKNOWN_TTL_MS = 60_000
const WAIT_MS = 3_500
/** A check running longer than this is presumed hung (the re-subscribe POST has no timeout); start a new one. */
const INFLIGHT_MAX_AGE_MS = 15_000

const recent = new Map<string, { at: number; value: MessengerDelivery }>()
const inflight = new Map<string, { startedAt: number; promise: Promise<MessengerDelivery> }>()

export async function checkMessengerDelivery(
  pageId: string,
  opts: {
    /**
     * When the Page row was last written by a reconnect, repair or sweep
     * (`facebook_pages.health_checked_at`). An answer older than that is stale on
     * every instance — otherwise a successful reconnect would land back on the
     * same prompt for five minutes.
     */
    rowCheckedAt?: Date | string | null
    now?: number
    waitMs?: number
  } = {},
): Promise<MessengerDelivery> {
  const now = opts.now ?? Date.now()
  const rowTime = opts.rowCheckedAt ? new Date(opts.rowCheckedAt).getTime() : 0
  const touchedAt = Number.isFinite(rowTime) ? rowTime : 0
  const hit = recent.get(pageId)
  const ttl = hit?.value === 'unknown' ? UNKNOWN_TTL_MS : SETTLED_TTL_MS
  if (hit && hit.at >= touchedAt && now - hit.at < ttl) return hit.value

  const running = inflight.get(pageId)
  // Join a running check only if it started after the row's last write and is not hung.
  const joinable = running && running.startedAt >= touchedAt && now - running.startedAt < INFLIGHT_MAX_AGE_MS
  const pending = joinable ? running.promise : start(pageId, now)
  return withDeadline(pending, opts.waitMs ?? WAIT_MS)
}

function start(pageId: string, now: number): Promise<MessengerDelivery> {
  const entry = { startedAt: now, promise: Promise.resolve<MessengerDelivery>('unknown') }
  entry.promise = evaluate(pageId)
    .then((value) => {
      recent.set(pageId, { at: now, value })
      return value
    })
    .finally(() => {
      if (inflight.get(pageId) === entry) inflight.delete(pageId)
    })
  inflight.set(pageId, entry)
  return entry.promise
}

/** Checks still running after the render stopped waiting; pass to `after()` so they finish and fill the cache. */
export function pendingMessengerDeliveryChecks(): Promise<void> {
  return Promise.allSettled([...inflight.values()].map((entry) => entry.promise)).then(() => undefined)
}

async function evaluate(pageId: string): Promise<MessengerDelivery> {
  try {
    const { needsReconnect, status } = await repairFacebookConnection(pageId)
    // `needsReconnect` is also set for a timeout or a rate limit; only a token Meta
    // refused is the customer's to fix.
    if (needsReconnect) {
      if (status.errors.includes('token_invalid')) return 'reconnect'
      // Missing permission: a reconnect fixes it, but the connection is not dead.
      return status.errors.includes('permission_missing') ? 'not_subscribed' : 'unknown'
    }
    if (status.missingFields === undefined) return 'unknown'
    return status.subscribed && status.missingFields.length === 0 ? 'ready' : 'not_subscribed'
  } catch {
    // e.g. a sealed token this deployment cannot open: a deployment fault, not the customer's.
    return 'unknown'
  }
}

function withDeadline(pending: Promise<MessengerDelivery>, ms: number): Promise<MessengerDelivery> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<MessengerDelivery>((resolve) => {
    timer = setTimeout(() => resolve('unknown'), ms)
  })
  return Promise.race([pending, late]).finally(() => clearTimeout(timer))
}

/** Test seam: forget every cached answer. */
export function resetMessengerDeliveryChecks(): void {
  recent.clear()
  inflight.clear()
}
