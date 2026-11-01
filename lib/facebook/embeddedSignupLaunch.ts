/**
 * The parameters SocialCRM launches WhatsApp Embedded Signup with: the
 * `FB.login` `extras` and the Graph version the SDK (and therefore Meta's
 * dialog) is initialised at. Pure; no SDK access.
 *
 * WHY COEXISTENCE. With no WhatsApp Business app onboarding, Meta runs the
 * default Cloud API flow, which for a number already live on the WhatsApp
 * Business app can only end one way: delete the app account, or onboard with a
 * provider that supports business app number onboarding. Coexistence replaces
 * the account selection screen with an option to connect the existing WhatsApp
 * Business account, keeping both working on one number.
 *
 * TWO VERSIONS, ONE SWITCH (`NEXT_PUBLIC_WA_EMBEDDED_SIGNUP_VERSION`, build-time):
 *
 *   unset (default) — Embedded Signup v4, exactly as production has run since
 *     2026-08-15: `{ version: 'v4', featureType: 'whatsapp_business_app_onboarding' }`,
 *     SDK at the app-wide Graph version.
 *   'v5' — Embedded Signup v5, Meta's latest (released 2026-10-20). WhatsApp
 *     Business app onboarding is ON by default, so the extras are just
 *     `{ version: 'v5' }`; the SDK is initialised at EMBEDDED_SIGNUP_SDK_VERSION,
 *     because the app-wide Graph version (v19.0) expired on 2026-05-21.
 *     Product configuration still comes from the Facebook Login for Business
 *     configuration (Meta: "as in v4"). v5's completion message carries
 *     `messaging_account_ids` instead of `waba_id`; embeddedSignupSession reads both.
 *
 * Kept behind a switch because Embedded Signup cannot run on a preview
 * deployment (Facebook Login is limited to the app's domain): v5 must be proven
 * with an internal WhatsApp Business app number before it becomes the default.
 *
 * `NEXT_PUBLIC_WA_COEXISTENCE_DISABLED=1` still turns WhatsApp Business app
 * onboarding off in either version (v5 through Meta's documented opt-out).
 * Both are inlined at build time: changing them needs a redeploy.
 */

export const COEXISTENCE_FEATURE_TYPE = 'whatsapp_business_app_onboarding'

/** Latest Graph API version (Meta changelog: v26.0, released 2026-07-29). Used for the v5 launch only. */
export const EMBEDDED_SIGNUP_SDK_VERSION = 'v26.0'

export type EmbeddedSignupVersion = 'v4' | 'v5'

/** Only the exact value 'v5' selects v5; anything else keeps v4. */
export function resolveEmbeddedSignupVersion(raw: string | undefined): EmbeddedSignupVersion {
  return raw === 'v5' ? 'v5' : 'v4'
}

export type EmbeddedSignupExtras =
  | { version: 'v4'; featureType: string }
  | { version: 'v5' }
  | { version: 'v5'; features: { name: string; enabled: boolean }[] }

export function embeddedSignupLaunchFor(args: {
  version: EmbeddedSignupVersion
  coexistenceDisabled: boolean
  appGraphVersion: string
}): { extras: EmbeddedSignupExtras; sdkVersion: string } {
  if (args.version === 'v5') {
    return {
      extras: args.coexistenceDisabled
        ? { version: 'v5', features: [{ name: COEXISTENCE_FEATURE_TYPE, enabled: false }] }
        : { version: 'v5' },
      sdkVersion: EMBEDDED_SIGNUP_SDK_VERSION,
    }
  }
  return {
    extras: { version: 'v4', featureType: args.coexistenceDisabled ? '' : COEXISTENCE_FEATURE_TYPE },
    sdkVersion: args.appGraphVersion,
  }
}

const VERSION = resolveEmbeddedSignupVersion(process.env.NEXT_PUBLIC_WA_EMBEDDED_SIGNUP_VERSION)
const COEXISTENCE_DISABLED = process.env.NEXT_PUBLIC_WA_COEXISTENCE_DISABLED === '1'

/** The launch parameters for this build. */
export function embeddedSignupLaunch(appGraphVersion: string) {
  return embeddedSignupLaunchFor({ version: VERSION, coexistenceDisabled: COEXISTENCE_DISABLED, appGraphVersion })
}
