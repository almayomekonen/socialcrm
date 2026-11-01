import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { ACTIVE, PHONE_USER, phoneEnv } from './phoneLeadsEnv'

/**
 * Renders the phone lead screens the way the (app) layout serves them inside
 * the phone shell: the interface-language provider (`null` = none, what a
 * Hebrew user received before i18n), entitlement, the session user and the
 * shell's header-action slot (the "+" the populated list registers renders in
 * `data-testid='header-action'`). The device gate is mocked to "phone" in each
 * test file (phoneLeadsMocks.ts); every component and producer is real.
 */

type Ent = typeof ACTIVE

function HeaderActionHost({ children, Ctx }: { children: ReactNode; Ctx: React.Context<React.Dispatch<React.SetStateAction<ReactNode>>> }) {
  const [action, setAction] = useState<ReactNode>(null)
  return (
    <Ctx.Provider value={setAction}>
      <div data-testid='header-action'>{action}</div>
      {children}
    </Ctx.Provider>
  )
}

export async function phoneShell(locale: UiLocale | null, node: ReactNode, ent: Ent = ACTIVE) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  const { UserProvider } = await import('@/lib/hooksNEvents')
  const { MobileHeaderActionContext } = await import('@/components/mobile/MobileHeaderAction')
  const inner = (
    <EntitlementProvider value={ent}>
      <UserProvider user={PHONE_USER}>
        <HeaderActionHost Ctx={MobileHeaderActionContext}>{node}</HeaderActionHost>
      </UserProvider>
    </EntitlementProvider>
  )
  return locale ? <I18nProvider locale={locale}>{inner}</I18nProvider> : inner
}

const isAsync = (type: unknown) => typeof type === 'function' && type.constructor?.name === 'AsyncFunction'

/** Awaits async server components; also expands the sync SERVER components in `expand` so their async children resolve. */
export async function resolveServer(node: ReactNode, expand: ReadonlySet<unknown>): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map((n) => resolveServer(n, expand)))
  if (!isValidElement(node)) return node
  const el = node as ReactElement<Record<string, unknown>>
  if (isAsync(el.type)) return resolveServer(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props), expand)
  if (expand.has(el.type)) return resolveServer((el.type as (p: unknown) => ReactNode)(el.props), expand)
  const next: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(el.props ?? {})) {
    if (isValidElement(value) || Array.isArray(value)) {
      next[key] = await resolveServer(value as ReactNode, expand)
      changed = true
    }
  }
  return changed ? cloneElement(el, next) : el
}

/** The REAL `/leads` page (phone branch). */
export async function phoneLeadsPage(params: Record<string, string> = {}) {
  const { default: LeadsPage } = await import('@/app/(he)/(app)/leads/page')
  return resolveServer(await LeadsPage({ searchParams: Promise.resolve(params) }), new Set())
}

/** The REAL `/clients/[clientId]/summary` page (phone branch). */
export async function phoneDetailPage(params: Record<string, string> = {}) {
  const { default: SummaryPage } = await import('@/app/(he)/(app)/clients/[clientId]/summary/page')
  const { default: LeadDetailMobile } = await import('@/modules/leads/mobile/LeadDetailMobile')
  const node = await SummaryPage({ params: Promise.resolve({ clientId: '41' }), searchParams: Promise.resolve(params) })
  return resolveServer(node, new Set([LeadDetailMobile]))
}

/** Build under `overrides`, then leave the rest of the env as it was. */
export function setPhone(overrides: Partial<typeof phoneEnv>) {
  Object.assign(phoneEnv, overrides)
}
