import { NextResponse } from 'next/server'
import { db } from '@/config/db'
import { getQuotaStatus } from '@/lib/quota'
import { countUnreadNotifications } from '@/db/notifications/feed'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { isTodayBriefEnabledForAgency } from '@/lib/today/rollout'
import { MobileAuthError, requireMobileUser } from '@/lib/mobile/auth'
import { fail, ok } from '@/lib/mobile/http'

/**
 * GET /api/mobile/v1/me — session bootstrap.
 *
 * The first authenticated call the app makes, and the only one that is allowed to
 * decide what the rest of the app may show. Everything here is SERVER-DERIVED:
 * the client sends a token and receives facts, never the other way round.
 *
 * DELIBERATELY REACHABLE WITHOUT PRODUCT ACCESS. It uses `requireMobileUser`, not
 * `requireMobileProductAccess`, because a rep whose trial has expired must still
 * be able to sign in and be told exactly why the product is blocked. Gating this
 * endpoint would render that state unreachable and look like a broken app.
 *
 * NEVER SERIALISED: `agencyId` and `idNum`. Tenancy is enforced per-query on the
 * server; sending the tenant key to a device would invite the client to start
 * believing it is an authorization input. The agency is described by NAME only,
 * which is all the UI renders.
 */
export async function GET(req: Request): Promise<NextResponse> {
  let user
  try {
    user = await requireMobileUser(req)
  } catch (err) {
    if (err instanceof MobileAuthError) return fail(err.code, err.status)
    throw err
  }

  try {
    const [agencyRow, userRow, access, quota, unreadNotifications] = await Promise.all([
      db('agencies')
        .where({ id: user.agencyId })
        .first('name', 'trialEndsAt', 'onboardingCompletedAt'),
      // Scoped to the caller's own row — never another user's photo.
      db('users').where({ id: user.id }).first('picture'),
      getAgencyProductAccess(user.agencyId),
      getQuotaStatus(user.agencyId),
      /**
       * The SAME count the desktop bell shows — `notifications` rows for this
       * user with no `readAt`, via the existing `countUnreadNotifications`.
       * Scoped to the caller's own agency and user id, so it can never report
       * another rep's backlog.
       */
      countUnreadNotifications({ agencyId: user.agencyId, userId: user.id }),
    ])

    /**
     * Only an absolute https URL is forwarded.
     *
     * The column is free text, and a client that blindly renders whatever it
     * contains would follow an http or `file://` value. Anything that is not a
     * plain https URL becomes null, and the client falls back to initials.
     */
    const rawPicture = typeof userRow?.picture === 'string' ? userRow.picture.trim() : ''
    const avatarUrl = rawPicture.startsWith('https://') ? rawPicture : null

    /**
     * `getAgencyProductAccess` can answer 'UNKNOWN' when the agency row is
     * missing or the read fails, and it deliberately fails OPEN so a paying
     * customer is never locked out by an infrastructure blip. 'UNKNOWN' is not a
     * state the client models, so it is reported as LEGACY — the existing status
     * that means exactly "has access, no trial countdown to display". The
     * alternative, inventing a new client-side status, would give the phone a
     * branch the web app does not have.
     */
    const status = access.status === 'UNKNOWN' ? 'LEGACY' : access.status

    /**
     * SERVER-COMPUTED, always. The device clock is never consulted: a phone with
     * a wrong date must not be able to talk itself into more trial days.
     * Meaningful only while a trial is actually running.
     */
    const daysRemaining =
      status === 'TRIAL_ACTIVE' && agencyRow?.trialEndsAt
        ? Math.max(
            0,
            Math.ceil((new Date(agencyRow.trialEndsAt).getTime() - Date.now()) / 86_400_000),
          )
        : null

    return ok({
      user: {
        id: user.id,
        name: user.name,
        firstName: user.firstName,
        // Rendered only. Row visibility is enforced server-side via gotPermIds,
        // which never crosses this boundary.
        role: user.role,
        /**
         * The signed-in user's own profile photo.
         *
         * `users.picture` is written by the Google sign-in paths (`checkUser`
         * and `/auth/google`) from the verified ID token, so it is a real asset
         * rather than anything this layer composes. It is the user's OWN photo —
         * not another user's, and not a tenant key — so surfacing it here leaks
         * nothing.
         *
         * Nullable in practice: only some accounts have one, and an agency logo
         * is not an alternative — `agencies.img` is an integer FK into the files
         * table, not a URL. The client falls back to initials.
         */
        avatarUrl: avatarUrl,
      },
      agency: { name: agencyRow?.name ?? '' },
      onboardingComplete: agencyRow?.onboardingCompletedAt != null,
      trial: { status, daysRemaining },
      quota,
      /**
       * EMPTY BECAUSE IT IS EMPTY, not because it is unimplemented. The backend
       * meters AI by a per-agency daily spend cap (`AI_DAILY_USD_CAP`), not by
       * per-mode call counts, so there are no per-mode quotas to report. When a
       * per-mode meter exists this becomes its projection; inventing numbers here
       * would put a fabricated allowance in front of the user.
       */
      aiQuotas: [],
      /**
       * Load-bearing. The same user must not get a v2 brief on the phone and a
       * legacy one on the desktop, so the phone reads the SAME rollout gate
       * rather than deciding for itself.
       */
      briefVariant: isTodayBriefEnabledForAgency(user.agencyId) ? 'v2' : 'legacy',
      /**
       * Real, and commonly zero. The client renders a badge only above zero —
       * never a fabricated number.
       */
      unreadNotifications,
    })
  } catch (err) {
    console.error('[mobile/me] failed', { userId: user.id, reason: (err as Error)?.message })
    return fail('server_error', 500)
  }
}
