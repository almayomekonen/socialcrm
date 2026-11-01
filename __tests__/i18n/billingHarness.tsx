import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import type { UiLocale } from '@/lib/i18n/config'
import { ACTIVE, BILL_DEFAULTS, billEnv } from './billingEnv'

/**
 * Renders the billing screens (Phase E3) the way the (app) layout does: the
 * interface-language provider, the entitlement state and the session user
 * around the REAL server page. Async server components are awaited in place;
 * `InvoiceFrozenView` is a SYNC server component that holds one (the timeline),
 * so it is expanded too. Mocks live in each test file (factories in
 * `billingMocks.ts`).
 */

type Ent = { hasAccess: boolean; status: string; expiresAt: string | null }

export async function billShell(locale: UiLocale | null, node: ReactNode, ent: Ent = ACTIVE) {
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  const { EntitlementProvider } = await import('@/lib/entitlement/EntitlementContext')
  const { UserProvider } = await import('@/lib/hooksNEvents')
  const inner = (
    <EntitlementProvider value={ent}>
      <UserProvider user={billEnv.user}>{node}</UserProvider>
    </EntitlementProvider>
  )
  // `null`: no provider at all — the Hebrew baseline renders exactly as before i18n.
  return locale ? <I18nProvider locale={locale}>{inner}</I18nProvider> : inner
}

const isAsync = (type: unknown) => typeof type === 'function' && type.constructor?.name === 'AsyncFunction'

async function resolveServer(node: ReactNode, expand: ReadonlySet<unknown>): Promise<ReactNode> {
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

async function serverTypes() {
  const { default: InvoiceFrozenView } = await import('@/components/billing/InvoiceFrozenView')
  return new Set<unknown>([InvoiceFrozenView])
}

export async function newInvoicePage(kind?: string) {
  const { default: Page } = await import('@/app/(he)/(app)/clients/[clientId]/billing/new/page')
  const searchParams = Promise.resolve(kind ? { kind } : {})
  return resolveServer(await Page({ params: Promise.resolve({ clientId: '41' }), searchParams }), await serverTypes())
}

export async function invoicePage(invoiceId = '9') {
  const { default: Page } = await import('@/app/(he)/(app)/clients/[clientId]/billing/[invoiceId]/page')
  return resolveServer(await Page({ params: Promise.resolve({ clientId: '41', invoiceId }) }), await serverTypes())
}

/** Run the page's server reads under `overrides`, then restore the defaults other surfaces expect. */
export async function withBillEnv<T>(overrides: Partial<typeof BILL_DEFAULTS>, build: () => Promise<T>): Promise<T> {
  Object.assign(billEnv, BILL_DEFAULTS, overrides, { results: {}, calls: [], active: true })
  try {
    return await build()
  } finally {
    Object.assign(billEnv, BILL_DEFAULTS, { results: {}, calls: [] })
  }
}
