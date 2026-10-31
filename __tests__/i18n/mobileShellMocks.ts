import { vi } from 'vitest'

/**
 * `vi.mock` factories for the phone shell tests (Phase F1). Only I/O and the
 * router are replaced; the shell, the "עוד" page, the handoffs and every copy
 * producer run for real. Each reads `shellEnv` (mobileShellEnv.ts).
 */

export const shellSpies = {
  back: vi.fn(),
  push: vi.fn(),
  copy: vi.fn(async (_text: string) => true),
  logout: vi.fn(async () => {}),
}

export function resetShellSpies() {
  for (const spy of Object.values(shellSpies)) spy.mockClear()
}

export async function navigationModule() {
  const { shellEnv } = await import('./mobileShellEnv')
  return {
    usePathname: () => shellEnv.pathname,
    useRouter: () => ({ push: shellSpies.push, back: shellSpies.back, refresh: () => {}, replace: () => {} }),
    redirect: (to: string) => {
      throw new Error('REDIRECT ' + to)
    },
  }
}

export async function authModule() {
  const { shellEnv } = await import('./mobileShellEnv')
  return { getUser: async () => shellEnv.user }
}

export async function uiLocaleModule() {
  const { shellEnv } = await import('./mobileShellEnv')
  return { getUiLocalePrefs: async () => ({ userLocale: shellEnv.userLocale, agencyLocale: null }) }
}

export async function deviceModule() {
  const { shellEnv } = await import('./mobileShellEnv')
  return { isMobileRequest: async () => shellEnv.mobile, isMobileWorkspaceRequest: async () => shellEnv.mobile }
}

export async function aiFlagsModule() {
  const { shellEnv } = await import('./mobileShellEnv')
  return { isAgentEnabled: () => shellEnv.agent, isCopilotInspectorEnabled: () => shellEnv.inspector }
}

export async function builderFlagsModule() {
  const { shellEnv } = await import('./mobileShellEnv')
  return { canUseQuestionnaireBuilder: () => shellEnv.questionnaire }
}

export async function clipboardModule() {
  const { shellEnv } = await import('./mobileShellEnv')
  return {
    copyToClipboard: async (text: string) => {
      await shellSpies.copy(text)
      return shellEnv.copyOk
    },
  }
}
