/**
 * Mutable fixtures for the pre-login / public screens (i18n Phase F4): `/auth`,
 * `/auth/register`, `/activate`, `/oauth/consent`, the root `ChunkReloader`.
 * Each test file wires its `vi.mock` factories (preLoginMocks.ts) to this
 * object; `resetPreLoginEnv()` restores it. Recorded calls (`calls`) let the
 * behaviour tests compare what was sent in every language.
 */

export type PreLoginUser = { id: number; agencyId: number; name?: string; gglName?: string; firstName?: string }

export const SIGNED_IN: PreLoginUser = { id: 7, agencyId: 103, name: 'דנה כהן', gglName: 'Dana', firstName: 'דנה' }

export type Eligibility =
  | { user: { agencyId: number; firstName: string | null } }
  | { reason: 'no_user' | 'no_agency' | 'suspended' | 'not_allowlisted' | 'trial_not_started' | 'subscription_required' }

const DEFAULTS = () => ({
  user: null as PreLoginUser | null,
  mobile: false,
  onboarded: false,
  canEnterMobile: false,
  /** Request cookies by name (the pre-login locale cookie, the OAuth pending cookie). */
  cookies: {} as Record<string, string>,
  facebookAuth: true,
  mcp: true,
  pending: {
    clientName: 'Claude',
    redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    scopes: ['crm.leads.read', 'crm.conversations.read'],
    csrf: 'c'.repeat(32),
    jti: 'j1',
  } as { clientName: string; redirectUri: string; scopes: string[]; csrf: string; jti: string } | null,
  pendingUsed: false,
  eligibility: { user: { agencyId: 103, firstName: 'דנה' } } as Eligibility,
  agencyName: 'סלון דנה' as string | null,
  /** Server action outcomes. */
  userExists: { ok: true } as Record<string, unknown>,
  sendToken: { ok: true } as Record<string, unknown>,
  checkUser: { ok: true } as Record<string, unknown> | undefined,
  checkFacebookUser: { ok: true } as Record<string, unknown> | undefined,
  addAgency: undefined as Record<string, unknown> | undefined,
  copyOk: true,
  /** The desktop activation state machine the (mocked) controller hands the screen. */
  machine: {
    status: 'waitingForActivation',
    context: { pages: [], selectedPageId: null, connectedPageName: null, errorReason: null },
  } as {
    status: string
    context: {
      pages: { id: string; name: string }[]
      selectedPageId: string | null
      connectedPageName: string | null
      errorReason: string | null
    }
  },
  alreadyConnected: null as boolean | null,
  continueOk: true,
  calls: [] as unknown[][],
})

export const preLoginEnv = DEFAULTS()

export function resetPreLoginEnv() {
  Object.assign(preLoginEnv, DEFAULTS())
}

export function record(...entry: unknown[]) {
  preLoginEnv.calls.push(entry)
}

/** Data the screens show verbatim (names, page names, an agency name): never translated. */
export const PRE_LOGIN_CUSTOMER_DATA = ['דנה כהן', 'דנה', 'סלון דנה', 'סטודיו נועה']
