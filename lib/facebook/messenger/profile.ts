import { db } from '@/config/db'
import { graphRequest, describeGraphError, type MetaGraphError } from '@/lib/facebook/graphClient'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { saveMessengerProfile, type MessengerProfileStatus } from '@/db/messenger'

/**
 * The customer's real name and picture for a Messenger contact.
 *
 * SOURCE, AND THE PERMISSION THAT GATES IT. The webhook carries a PSID only.
 * Everything human about the contact comes from the User Profile API,
 * GET /{PSID}?fields=first_name,last_name,profile_pic with the PAGE token.
 * Per https://developers.facebook.com/docs/messenger-platform/identity/user-profile
 * (checked 2026-09-23) all three fields require the *Business Asset User Profile
 * Access* feature in Advanced Access. `pages_messaging` does NOT grant them.
 * An app without that feature is refused for every contact, permanently — so a
 * refusal is recorded as `denied` and never retried on a timer. Messaging keeps
 * working either way; this is a display nicety, and it is the ONLY part of the
 * Messenger feature that depends on that approval.
 *
 * NEVER INVENTS. A refusal leaves `customerName` NULL and the UI falls back to
 * initials. No placeholder name and no stock photo is ever written or shown.
 *
 * NEVER THE ADMIN. The PSID identifies the CUSTOMER within one Page. The Page
 * token is only the credential used to ask; the connecting administrator's own
 * profile is never read here and can never land on a conversation.
 *
 * NEVER THROWS.
 */

/** Meta's CDN URLs are signed and expire. Past this the row is refetched. */
export const PROFILE_TTL_MS = 3 * 24 * 60 * 60 * 1000

/** Cap per pass, so one busy inbox cannot fan out into Graph. */
export const PROFILE_REFRESH_BATCH = 8

/** 'transient' is never persisted — it means "ask again next time". */
export type MessengerProfileOutcome = MessengerProfileStatus | 'transient'

export type MessengerProfile = {
  name: string | null
  picUrl: string | null
  status: MessengerProfileOutcome
}

/**
 * A refusal that re-asking cannot fix.
 *
 * Code 10 and the 200-299 family are Meta's permission errors; subcode 2018218
 * is the User Profile API's own "cannot fetch profile" for a person the Page may
 * not read. 100 with no subcode on this edge means the field set itself was
 * rejected, which for a fixed field list is a capability answer too. Everything
 * else (network, timeout, rate limit, 5xx) stays unrecorded so the next pass
 * tries again.
 */
export function isProfileAccessDenied(error: MetaGraphError): boolean {
  if (error.kind !== 'graph') return false
  const { code, subcode, status } = error
  if (subcode === 2018218) return true
  if (code === 10) return true
  if (code !== null && code >= 200 && code <= 299) return true
  if (code === 100 && subcode === null) return true
  return status === 403
}

type ProfileFields = { first_name?: unknown; last_name?: unknown; name?: unknown; profile_pic?: unknown }

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Meta returns absolute https CDN URLs. Anything else is not rendered. */
function httpsUrl(v: unknown): string | null {
  const s = text(v)
  return s && s.startsWith('https://') ? s : null
}

/**
 * Ask Meta once. Returns what it said, classified — never throws, never guesses.
 * Exported so tests can drive it with a fetch stub.
 */
export async function fetchMessengerProfile(input: {
  psid: string
  pageAccessToken: string
  fetchImpl?: typeof fetch
}): Promise<MessengerProfile> {
  const result = await graphRequest<ProfileFields>({
    path: `/${encodeURIComponent(input.psid)}`,
    token: input.pageAccessToken,
    query: { fields: 'first_name,last_name,profile_pic' },
    timeoutMs: 4000,
    fetchImpl: input.fetchImpl,
  })

  // `'error' in result`, not `!result.ok`: this project compiles with
  // strictNullChecks off, where a boolean-literal discriminant does not narrow.
  // Same idiom as send.ts.
  if ('error' in result) {
    if (isProfileAccessDenied(result.error)) {
      // Once per contact, not per render: the line that tells an operator the app
      // is missing Business Asset User Profile Access.
      console.warn('[MessengerProfile] Meta refused profile access', { detail: describeGraphError(result.error) })
      return { name: null, picUrl: null, status: 'denied' }
    }
    return { name: null, picUrl: null, status: 'transient' }
  }

  const d = ('data' in result ? result.data : null) ?? {}
  const name = [text(d.first_name), text(d.last_name)].filter(Boolean).join(' ').trim() || text(d.name) || null
  const picUrl = httpsUrl(d.profile_pic)
  // Reached Meta, and it described a person with neither name nor picture. Real,
  // and worth recording so we stop asking every few days.
  return { name, picUrl, status: name || picUrl ? 'ok' : 'unavailable' }
}

/** True when this conversation's profile is worth a Graph call right now. */
export function profileIsDue(
  row: { profileStatus: string | null; profileFetchedAt: Date | string | null },
  now: Date,
  ttlMs: number = PROFILE_TTL_MS,
): boolean {
  if (row.profileStatus === 'denied') return false
  if (!row.profileFetchedAt) return true
  const at = new Date(row.profileFetchedAt).getTime()
  if (Number.isNaN(at)) return true
  return now.getTime() - at >= ttlMs
}

/**
 * Refresh the profiles of one agency's conversations that are due.
 *
 * Called from `after()`, so it never delays a response, and bounded by
 * PROFILE_REFRESH_BATCH. Each contact is independent: one refusal does not stop
 * the rest. `force` is for the explicit "refresh picture" path, where the
 * browser reported a dead CDN URL and the TTL has not expired yet.
 */
export async function refreshMessengerProfiles(input: {
  agencyId: number
  conversationIds?: number[]
  now?: Date
  limit?: number
  force?: boolean
}): Promise<{ attempted: number; ok: number; denied: number }> {
  const now = input.now ?? new Date()
  const summary = { attempted: 0, ok: 0, denied: 0 }
  try {
    const q = db('messenger_conversations')
      .where({ agencyId: input.agencyId })
      // A denied app is denied for every contact; re-asking only burns quota.
      .whereRaw(`("profileStatus" IS DISTINCT FROM 'denied')`)
      .orderByRaw('"profileFetchedAt" ASC NULLS FIRST')
      .limit(input.limit ?? PROFILE_REFRESH_BATCH)
      .select('id', 'psid', 'pageId')
    if (!input.force) {
      q.whereRaw(`("profileFetchedAt" IS NULL OR "profileFetchedAt" < ?)`, [new Date(now.getTime() - PROFILE_TTL_MS)])
    }
    if (input.conversationIds?.length) q.whereIn('id', input.conversationIds)
    const due = (await q) as { id: number | string; psid: string; pageId: string }[]
    if (due.length === 0) return summary

    // One token lookup per Page, not per contact. Scoped to the agency, so a
    // Page row belonging to another tenant can never supply a token here.
    const pageIds = [...new Set(due.map((d) => d.pageId))]
    const pages = (await db('facebook_pages')
      .whereIn('page_id', pageIds)
      .andWhere({ agency_id: input.agencyId })
      .select('page_id', 'page_access_token')) as { page_id: string; page_access_token: string }[]
    const tokenByPage = new Map<string, string>()
    for (const p of pages) {
      try {
        tokenByPage.set(p.page_id, resolvePageAccessToken(p.page_access_token))
      } catch {
        // A token that will not open is a connection problem, reported elsewhere.
      }
    }

    for (const row of due) {
      const token = tokenByPage.get(row.pageId)
      if (!token) continue
      summary.attempted++
      const profile = await fetchMessengerProfile({ psid: row.psid, pageAccessToken: token })
      if (profile.status === 'transient') continue
      if (profile.status === 'denied') summary.denied++
      else summary.ok++
      await saveMessengerProfile({
        conversationId: Number(row.id),
        agencyId: input.agencyId,
        name: profile.name,
        picUrl: profile.picUrl,
        status: profile.status,
        at: new Date(),
      })
    }
  } catch (err) {
    console.error('[MessengerProfile] refresh failed:', err instanceof Error ? err.message : 'unknown')
  }
  return summary
}

/**
 * First contact: fetch the profile immediately so the rep sees a real name on
 * the very first message rather than after the next sweep.
 */
export async function fillMessengerCustomerName(input: {
  conversationId: number
  agencyId: number
  pageId: string
}): Promise<void> {
  await refreshMessengerProfiles({
    agencyId: input.agencyId,
    conversationIds: [input.conversationId],
    limit: 1,
    force: true,
  })
}
