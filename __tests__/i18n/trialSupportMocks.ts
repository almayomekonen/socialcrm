import { trialSupportEnv as env, record } from './trialSupportEnv'

/**
 * `vi.mock` factories for the trial gate, `/billing/success` and the support
 * centre (i18n Phase F5). I/O only: the pages, components and copy producers
 * run for real. Every action and navigation is RECORDED in `env.calls`.
 */

const outcome = (v: unknown) => (typeof v === 'function' ? (v as () => unknown)() : v)

export function navigationModule() {
  return {
    usePathname: () => '/support',
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({
      push: (to: string) => record('router.push', to),
      replace: (to: string) => record('router.replace', to),
      refresh: () => record('router.refresh'),
      back: () => {},
    }),
    redirect: (to: string) => {
      throw new Error('REDIRECT ' + to)
    },
    notFound: () => {
      throw new Error('NEXT_NOT_FOUND')
    },
  }
}

export function authDbModule() {
  return { getUser: async () => env.user }
}

export async function requireUserModule() {
  const { vi } = await import('vitest')
  const actual = await vi.importActual<typeof import('@/lib/requireUser')>('@/lib/requireUser')
  return {
    ...actual,
    requireAgencyUser: async () => {
      if (!env.user) throw new actual.AuthError('no_session')
      return env.user
    },
  }
}

export function uiLocaleDbModule() {
  return { getUiLocalePrefs: async () => ({ userLocale: env.userLocale, agencyLocale: null }) }
}

export function preLoginServerModule() {
  return { getPreLoginLocale: async () => env.cookieLocale }
}

export function supportRequestsDbModule() {
  return {
    listSupportRequestsSystem: async (input: Record<string, unknown>) => {
      record('listSupportRequestsSystem', input)
      return env.requests.slice(0, Number(input.limit ?? 50))
    },
    getSupportRequestSystem: async (input: Record<string, unknown>) => {
      record('getSupportRequestSystem', input)
      return env.request
    },
  }
}

export function supportMessagesDbModule() {
  return {
    listSupportMessagesSystem: async (input: Record<string, unknown>) => {
      record('listSupportMessagesSystem', input)
      return env.messages
    },
  }
}

export function supportActionsModule() {
  return {
    createSupportRequestAction: async (input: unknown) => {
      record('createSupportRequestAction', input)
      return outcome(env.createResult)
    },
    replyToSupportRequestAction: async (requestId: number, body: string) => {
      record('replyToSupportRequestAction', { requestId, body })
      return outcome(env.replyResult)
    },
  }
}

export function trialActionsModule() {
  return {
    startTrial: async () => {
      record('startTrial')
      return outcome(env.startTrial)
    },
    trackTrialStartClicked: async () => record('trackTrialStartClicked'),
    trackTrialStartFailed: async (reason: string) => record('trackTrialStartFailed', reason),
    trackWelcomeModalSeen: async () => {
      record('trackWelcomeModalSeen')
      return { ok: true }
    },
  }
}

export function paymentMethodActionsModule() {
  return {
    startCardSetup: async (input: unknown) => {
      record('startCardSetup', input)
      return outcome(env.startCardSetup)
    },
    getCardSetupStatus: async () => {
      record('getCardSetupStatus')
      return outcome(env.setupStatus)
    },
  }
}

export function pixelEventsModule() {
  return { trackStartTrial: () => record('trackStartTrial') }
}

export function toastModule() {
  return {
    toast: (kind: string, message?: string) => record('toast', { kind, message: message ?? null }),
    proToast: () => {},
    setToastDefaults: () => {},
    resetToastDefaults: () => {},
    default: () => null,
  }
}
