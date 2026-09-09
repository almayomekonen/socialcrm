'use server'
import { createCookie, getUser } from '@/db/auth'
import { db } from '@/config/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { after } from 'next/server'
import { requireProductAccess } from '@/lib/requireUser'
import { normalizeEmail } from '@/lib/normalizeEmail'
import { isMobileRequest } from '@/lib/device'
import { dispatchLifecycleEvent } from '@/lib/emailAutomations/live'
import { track } from '@/lib/analytics/track'
import { emitLifecycleEvent } from '@/lib/events/emit'
import {
  clearFacebookLoginProof,
  facebookSubFromProof,
  isFacebookSubUniqueViolation,
  readFacebookLoginProof,
} from '@/lib/auth/fbLoginProof'
import { isFacebookUserAuthOpenToNewAgencies } from '@/lib/auth/facebookUserAuthFlags'
import { readSignupAttribution } from '@/lib/activation/signupAttribution'

export async function addAgency(data) {
  const start = Date.now()
  const email = normalizeEmail(data?.user?.email)
  let success = false
  let newUser: { email: string; firstName: string } | null = null
  let createdUserId: number | null = null
  let createdAgencyId: number | null = null
  // New-agency Facebook attach is closed during a numbered-id canary so a
  // leftover fb_login proof cannot create an unauthorized workspace.
  const facebookSub = isFacebookUserAuthOpenToNewAgencies()
    ? facebookSubFromProof(await readFacebookLoginProof())
    : undefined
  try {
    await db.transaction(async (trx) => {
      // Onboarding is complete the moment the agency exists. Written here, in the
      // same transaction as the agency row, so a new workspace is never created in
      // a state that the (app) layout gate would bounce to /activate — the gate
      // itself is deliberately untouched and still guards agencies whose column is
      // NULL. Connecting Facebook later calls completeOnboarding(), whose
      // `whereNull` guard makes it a silent no-op; nothing reads its return value.
      const agency = await trx('agencies')
        .insert({ name: data?.agency?.name, onboardingCompletedAt: trx.fn.now() })
        .returning('id')
      const agencyId = agency[0]?.id

      const userRow: Record<string, unknown> = {
        firstName: data?.user?.firstName,
        lastName: data?.user?.lastName,
        email,
        agencyId,
        role: 'ADMIN',
      }
      // facebookSub is taken only from the server-verified fb_login cookie.
      // Client fields, URL params, and hidden inputs are ignored.
      if (facebookSub) userRow.facebookSub = facebookSub

      const [user] = await trx('users').insert(userRow).returning('*')
      await trx('users_info').insert({ id: user.id }).onConflict('id').merge()
      await trx('default_settings').insert({ userId: user.id })
      newUser = { email: user.email, firstName: user.firstName }
      createdUserId = user.id
      createdAgencyId = agencyId
      success = true
    })
  } catch (err: any) {
    if (err?.code === '23505') {
      if (isFacebookSubUniqueViolation(err)) {
        console.warn(`[AUTH] route=register email=${email} ms=${Date.now() - start} result=fail reason=duplicate_facebook`)
        return { error: 'חשבון פייסבוק זה כבר מחובר למערכת. התחבר באמצעות Facebook.' }
      }
      console.warn(`[AUTH] route=register email=${email} ms=${Date.now() - start} result=fail reason=duplicate`)
      return { error: 'כתובת האימייל הזו כבר רשומה במערכת' }
    }
    console.error(`[AUTH] route=register email=${email} ms=${Date.now() - start} result=fail reason=server_error`, err)
    return { error: 'אירעה שגיאה, נסה שוב' }
  }

  if (success && newUser && createdUserId) {
    await clearFacebookLoginProof()
    await createCookie(createdUserId)
    console.log(`[AUTH] route=register email=${email} ms=${Date.now() - start} result=success`)
    const device = data?.device === 'desktop' || data?.device === 'mobile' ? data.device : 'unknown'
    /**
     * `device` above is the CLIENT's viewport check (matchMedia 1000px). The
     * redirect below — and the (app) layout gate — use isMobileRequest(), a
     * server-side User-Agent check. The two disagree for tablets (UA 'tablet',
     * viewport 'mobile') and for narrow desktop windows, so `device` alone
     * OVERSTATES the population that actually gets redirected.
     *
     * `isPhone` records the authoritative signal alongside it rather than
     * replacing it: overwriting `device` would silently change the meaning of a
     * prop that existing rows already carry, making new data incomparable with
     * old. Both are kept, and the funnel query can migrate to `isPhone`.
     *
     * Resolved HERE because headers are unreadable inside after().
     */
    const isPhone = await isMobileRequest()
    /**
     * Campaign attribution, written on the marketing shell up to 30 days ago.
     * Merged into the EXISTING props jsonb — no column, no migration. Absent for
     * anyone who reached /auth directly, which is a normal result and not an
     * error: the props simply carry what they carried before.
     *
     * Read here, beside isPhone, for the same reason — cookies are unreadable
     * inside after().
     */
    const attribution = await readSignupAttribution()
    const agencyIdForEvent = createdAgencyId
    const userIdForEvent = createdUserId
    after(() =>
      track({
        agencyId: agencyIdForEvent!,
        userId: userIdForEvent,
        event: 'registration_completed',
        props: { device, isPhone, ...attribution },
      }),
    )
    after(() =>
      dispatchLifecycleEvent(
        'user.registered',
        { userId: userIdForEvent, agencyId: agencyIdForEvent!, email, firstName: newUser!.firstName },
        new Date(),
      ),
    )

    const provider =
      facebookSub ? 'facebook' : data?.provider === 'google' || data?.provider === 'email' ? data.provider : null
    after(() =>
      emitLifecycleEvent({
        type: 'user.registered',
        userId: userIdForEvent,
        agencyId: agencyIdForEvent!,
        email,
        firstName: newUser!.firstName,
        plan: null,
        provider,
      }),
    )

    // Straight into the workspace. The target is resolved with the SAME
    // server-side device check the (app) layout gate uses (lib/device.ts), so
    // this redirect can never disagree with the redirect that runs on the very
    // next request:
    //   phone   → /activate — where the layout would send them anyway. Routing
    //             phones via /leads would be a regression, not a no-op:
    //             redirect() drops the query string, so ?welcome would be gone
    //             before RegistrationPixel could fire and mobile registration
    //             attribution would be silently lost.
    //   desktop → /leads — LeadsFirstRun is the first-run experience.
    // `welcome` no longer drives any UI: the greeting toast it fed was removed,
    // and <WelcomeParamCleanup/> on /leads strips it from the URL. An empty
    // value is valid.
    const welcome = encodeURIComponent((newUser!.firstName ?? '').trim())

    /**
     * REGISTRATION CONVERSION SIGNAL — deliberately a cookie, not the URL.
     *
     * `welcome` cannot carry the CompleteRegistration pixel, because both
     * emitters that keyed off it were dead in production: on desktop /leads
     * never renders for a brand-new agency (the (app) layout renders
     * WorkspaceTeaser INSTEAD of {children} while the trial is NEVER_STARTED),
     * and on mobile /activate redirects an onboarded, allowlisted phone to
     * /dashboard before RegistrationPixel mounts — with redirect() dropping the
     * query string on the way, so ?welcome is gone regardless.
     *
     * A cookie survives both redirects and every layout branch. Read once by
     * <RegistrationConversion/> and deleted there; 10 minutes is the outer bound
     * on "the browser that just registered". `httpOnly: false` is required — a
     * client component is the reader — and the value is the new user id, which
     * is not a secret and is already RegistrationPixel's localStorage dedup key.
     */
    const cookieStore = await cookies()
    cookieStore.set('scrm_reg', String(createdUserId), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10,
      path: '/',
    })

    redirect((await isMobileRequest()) ? `/activate?welcome=${welcome}` : `/leads?welcome=${welcome}`)
  }
  return success
}

export async function updatePkg(pkg) {
  const user = await getUser()
  await db('agencies').where({ id: user.agencyId }).update({ pkg })
  revalidatePath('/deals')
  revalidatePath('/settings/update_payment')
}

export async function updateAgency(data, id) {
  await requireProductAccess()
  await db('agencies').where({ id }).update(data)
  revalidatePath('/settings/update_agency')
}
