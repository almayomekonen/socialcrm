import { useEffect } from 'react'
import { preLoginEnv as env, record } from './preLoginEnv'

/**
 * `vi.mock` factories for the pre-login tests (i18n Phase F4). I/O only: the
 * pages, components and copy producers run for real. Every server action and
 * navigation is RECORDED in `preLoginEnv.calls`, so a test can replay the same
 * taps in he / en / ar and compare what was sent.
 */

/** An outcome may be a thunk (a rejection or a never-settling promise, created only when the action runs). */
const outcome = (v: unknown) => (typeof v === 'function' ? (v as () => unknown)() : v)

export function navigationModule() {
  return {
    usePathname: () => '/auth',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({
      push: (to: string) => record('router.push', to),
      replace: (to: string) => record('router.replace', to),
      refresh: () => {},
      back: () => {},
    }),
    unstable_rethrow: () => {},
    redirect: (to: string) => {
      throw new Error('REDIRECT ' + to)
    },
    notFound: () => {
      throw new Error('NEXT_NOT_FOUND')
    },
  }
}

export function headersModule() {
  return {
    cookies: async () => ({
      get: (name: string) => (name in env.cookies ? { name, value: env.cookies[name] } : undefined),
    }),
    headers: async () => new Headers(),
  }
}

export function authDbModule() {
  return { getUser: async () => env.user }
}

export function deviceModule() {
  return {
    isMobileRequest: async () => env.mobile,
    isMobileWorkspaceRequest: async () => env.mobile,
    getInAppBrowser: async () => null,
  }
}

export function facebookAuthFlagsModule() {
  return {
    isFacebookUserAuthEnabled: () => env.facebookAuth,
    isFacebookUserAuthAgencyAllowlisted: () => env.facebookAuth,
    canUseFacebookUserAuth: () => env.facebookAuth,
    isFacebookUserAuthPubliclyAvailable: () => env.facebookAuth,
    isFacebookUserAuthOpenToNewAgencies: () => env.facebookAuth,
  }
}

export function authActionsModule() {
  return {
    isUserExists: async (email: string) => (record('isUserExists', email), outcome(env.userExists)),
    sendToken: async (email: string) => (record('sendToken', email), outcome(env.sendToken)),
    checkUser: async (input: unknown) => (record('checkUser', input), outcome(env.checkUser)),
    checkFacebookUser: async (input: unknown) => (record('checkFacebookUser', input), outcome(env.checkFacebookUser)),
    logout: async () => {},
  }
}

export function agenciesActionsModule() {
  return { addAgency: async (data: unknown) => (record('addAgency', data), outcome(env.addAgency)) }
}

export function toastModule() {
  return {
    toast: (kind: string, msg?: string) => record('toast', kind, msg),
    proToast: () => {},
    setToastDefaults: () => {},
    resetToastDefaults: () => {},
    default: () => null,
  }
}

export function activationActionsModule() {
  return {
    trackActivation: async (event: string) => record('trackActivation', event),
    getActivationData: async () => ({ alreadyConnected: false, pendingPages: [] }),
    completeOnboarding: async () => record('completeOnboarding'),
  }
}

export function oauthPendingModule() {
  return {
    PENDING_COOKIE: 'scrm_oauth_pending',
    verifyPendingRequest: async (raw?: string | null) => (record('verifyPendingRequest', raw ?? null), env.pending),
  }
}

export function consentEligibilityModule() {
  return { checkConsentEligibility: async (id: number) => (record('checkConsentEligibility', id), env.eligibility) }
}

/** `db('agencies').where(...).first('name')` for the consent page, plus `isPendingRequestUsed`'s lookup. */
export function configDbModule() {
  const chain = {
    where: (q: unknown) => (record('db.where', q), chain),
    first: async () => (env.agencyName === null ? undefined : { name: env.agencyName }),
  }
  return { db: () => chain }
}

/** `next/script` that records its `src` and fires `onLoad` on mount (the SDKs are stubbed by the scenario). */
export function scriptModule() {
  function Script({ onLoad, src }: { onLoad?: () => void; src: string }) {
    useEffect(() => {
      record('script', src)
      onLoad?.()
    }, [])
    return null
  }
  return { default: Script }
}

export function activationControllerModule() {
  return {
    useActivationController: () => ({
      machine: env.machine,
      alreadyConnected: env.alreadyConnected,
      startOAuth: () => record('startOAuth'),
      selectPage: (id: string) => record('selectPage', id),
      retry: () => record('retry'),
      continueDesktop: async () => (record('continueDesktop'), env.continueOk),
    }),
  }
}

export function onboardingModule() {
  return { isOnboarded: async () => env.onboarded, completeOnboarding: async () => true }
}

export function mobileFlagsModule() {
  return { canEnterMobileWorkspace: () => env.canEnterMobile }
}

export function mcpFlagsModule() {
  return { isMcpEnabled: () => env.mcp, isMcpAgencyAllowlisted: () => true, canUseMcp: () => env.mcp }
}

export function clipboardModule() {
  return { copyToClipboard: async (text: string) => (record('copyToClipboard', text), env.copyOk) }
}
