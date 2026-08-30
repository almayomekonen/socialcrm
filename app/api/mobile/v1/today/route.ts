import { NextResponse } from 'next/server'
import { buildTodayBrief } from '@/lib/today/service'
import { MobileAuthError, requireMobileProductAccess } from '@/lib/mobile/auth'
import { fail, ok } from '@/lib/mobile/http'

/**
 * GET /api/mobile/v1/today — the rep's work queue.
 *
 * A THIN ADAPTER, and nothing more. Every number, every Hebrew label, every
 * ordering decision is computed by the SAME `buildTodayBrief` the web app calls.
 * This handler resolves identity, hands the scope down, and projects the result.
 * No business rule is re-implemented here, because a second implementation is a
 * second set of bugs and the phone would slowly start disagreeing with the desktop
 * about what the day looks like.
 *
 * SCOPE IS PASSED DOWN, NEVER RESOLVED BELOW. `buildTodayBrief` accepts a viewer
 * precisely so a caller without a cookie can use it — the same door
 * `lib/agent/tools/getTodayState.ts` already goes through. `agencyId` and
 * `gotPermIds` come from the verified token's user, never from the request.
 *
 * PRODUCT-GATED, unlike `/me`. This is product functionality: an agency with no
 * active trial or subscription gets a typed 403 the client turns into the right
 * activation screen, rather than an empty list that would read as "no work today".
 */
export async function GET(req: Request): Promise<NextResponse> {
  let user
  try {
    user = await requireMobileProductAccess(req)
  } catch (err) {
    if (err instanceof MobileAuthError) return fail(err.code, err.status)
    throw err
  }

  try {
    const brief = await buildTodayBrief(
      {
        scope: { user: { role: user.role }, gotPermIds: user.gotPermIds },
        agencyId: user.agencyId,
        userId: user.id,
        firstName: user.firstName ?? '',
      },
      Date.now(),
    )

    /**
     * PROJECTED FIELD BY FIELD, never spread.
     *
     * An allow-list is the only way this boundary stays safe as `BriefItem` grows:
     * a spread would silently start shipping whatever the Today engine adds next
     * — including fields carrying tenant keys or PII the phone has no use for.
     * Adding a field to the mobile contract should require editing this list.
     *
     * `name` and `title` are coalesced because the client models them as present.
     * A lead genuinely can have no name; it renders as an unnamed row rather than
     * failing the whole response's validation.
     */
    return ok({
      greeting: brief.greeting,
      firstName: brief.firstName,
      items: brief.items.map((item) => ({
        id: item.id,
        name: item.name ?? '',
        phone: item.phone ?? null,
        state: item.state,
        // Server-computed Hebrew. The client never builds this string.
        reason: item.reason,
        targetSurface: item.targetSurface,
      })),
      total: brief.total,
      remaining: brief.remaining,
      handledToday: brief.handledToday,
      done: brief.done,
      volumeState: brief.volumeState,
      statusVerdict: brief.statusVerdict,
      /**
       * Load-bearing honesty. `scoped_partial` means this rep can only see part of
       * the agency's work, so "you're all done" must be qualified rather than
       * claimed outright.
       */
      permissionVerdict: brief.permissionVerdict,
      meetings: brief.meetings.map((m) => ({
        id: m.id,
        title: m.title ?? '',
        at: m.at,
      })),
    })
  } catch (err) {
    /**
     * A failure here is NOT an empty day. The handler returns 500 so the client
     * shows its error state; a `200 { items: [] }` fallback would tell a rep with
     * eleven overdue leads that they have nothing to do.
     */
    console.error('[mobile/today] failed', { userId: user.id, reason: (err as Error)?.message })
    return fail('server_error', 500)
  }
}
