/**
 * Boot-time validation for the mobile auth configuration.
 *
 * WHY THIS EXISTS. `MOBILE_JWT_SECRET` is read lazily, inside `mobileKey()`, on
 * the first mint or verify. That fails closed — which is right — but it fails
 * closed as a 500 on a user's first request, hours after a deploy, in a handler
 * whose logs say only "failed". A missing signing key is a deployment fault, and
 * a deployment fault should be visible at boot.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: read, log, or echo any secret VALUE. It
 * reports presence and length only.
 */

export type MobileAuthEnvIssue = {
  variable: string
  problem: string
  /** Fatal in production; a warning elsewhere. */
  fatal: boolean
}

export type MobileAuthEnvResult = {
  status: 'ok' | 'warn' | 'fatal'
  issues: MobileAuthEnvIssue[]
}

/** Matches the floor enforced in `lib/mobile/tokens.ts#mobileKey`. */
const MIN_SECRET_LENGTH = 32

export function checkMobileAuthEnv(
  env: NodeJS.ProcessEnv = process.env,
): MobileAuthEnvResult {
  const isProduction = env.NODE_ENV === 'production'
  const issues: MobileAuthEnvIssue[] = []

  /**
   * The signing key. Without it EVERY mobile request fails — sign-in, refresh,
   * and every authenticated read — so in production this is fatal.
   */
  const secret = env.MOBILE_JWT_SECRET
  if (!secret) {
    issues.push({
      variable: 'MOBILE_JWT_SECRET',
      problem: 'missing — every mobile API request will fail',
      fatal: isProduction,
    })
  } else if (secret.length < MIN_SECRET_LENGTH) {
    issues.push({
      variable: 'MOBILE_JWT_SECRET',
      problem: `too short (${secret.length} chars, needs >= ${MIN_SECRET_LENGTH})`,
      fatal: isProduction,
    })
  } else if (secret === env.JWT_SECRET) {
    /**
     * Sharing the web key would recreate exactly the problem the separate key
     * exists to prevent: `JWT_SECRET` also signs `encrypt()` output — fb_pages,
     * WhatsApp phone numbers, the deal-export link — with a 365-day lifetime.
     * One key means those token classes become interchangeable with a phone
     * credential.
     */
    issues.push({
      variable: 'MOBILE_JWT_SECRET',
      problem: 'identical to JWT_SECRET — the two key classes must not be interchangeable',
      fatal: isProduction,
    })
  }

  /**
   * Google audiences. Not fatal at boot: the verifier already fails closed with
   * "no audience" (which it treats as "accept nothing", never "accept anything"),
   * and a deployment may legitimately run with only the web client configured
   * while native client IDs are still being created. But a production server
   * with no native audience cannot sign anyone in from a phone, so it is loud.
   */
  const audiences = [
    env.MOBILE_GOOGLE_IOS_CLIENT_ID,
    env.MOBILE_GOOGLE_ANDROID_CLIENT_ID,
    env.NEXT_PUBLIC_GGLID,
  ].filter((value) => typeof value === 'string' && value.length > 0)

  if (audiences.length === 0) {
    issues.push({
      variable: 'MOBILE_GOOGLE_*_CLIENT_ID / NEXT_PUBLIC_GGLID',
      problem: 'no Google client ID configured — mobile Google sign-in cannot verify any token',
      fatal: false,
    })
  }

  /**
   * The development sign-in must not be configured in production. The endpoint
   * itself already 404s on `NODE_ENV === 'production'`, so this cannot open a
   * door — it catches a leaked secret in the wrong environment file.
   */
  if (isProduction && (env.MOBILE_DEV_AUTH_SECRET || env.MOBILE_DEV_AUTH_EMAIL)) {
    issues.push({
      variable: 'MOBILE_DEV_AUTH_SECRET / MOBILE_DEV_AUTH_EMAIL',
      problem: 'set in a production environment — remove them',
      fatal: false,
    })
  }

  if (issues.some((issue) => issue.fatal)) return { status: 'fatal', issues }
  return { status: issues.length > 0 ? 'warn' : 'ok', issues }
}

/**
 * Boot gate. Throws in production when the mobile API could not possibly work,
 * warns otherwise.
 *
 * Development is deliberately never fatal: a web-only contributor should not
 * have to configure mobile secrets to run the app.
 */
export function assertMobileAuthEnv(env: NodeJS.ProcessEnv = process.env): void {
  const { status, issues } = checkMobileAuthEnv(env)
  if (status === 'ok') return

  for (const issue of issues) {
    const line = `[startup/mobile-auth] ${issue.variable}: ${issue.problem}`
    if (issue.fatal) console.error(line)
    else console.warn(line)
  }

  if (status === 'fatal') {
    throw new Error(
      '[startup/mobile-auth] mobile authentication is misconfigured — see the errors above',
    )
  }
}
