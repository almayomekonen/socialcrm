import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'

/**
 * Renders the REAL `/dashboard` server component for tests.
 *
 * React's string renderer cannot run async Server Components, so this walks
 * the returned element tree and awaits every async component it finds
 * (`AnalyticsOverview`, `FunnelCard`) in place — including ones passed as
 * props (`TodayBriefView`'s `overview`/`funnel`). Sync and client components
 * are left for the renderer, so their hooks run normally.
 */
function isAsyncComponent(type: unknown): type is (props: unknown) => Promise<ReactNode> {
  return typeof type === 'function' && type.constructor?.name === 'AsyncFunction'
}

export async function resolveAsync(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveAsync))
  if (!isValidElement(node)) return node
  const element = node as ReactElement<Record<string, unknown>>
  if (isAsyncComponent(element.type)) return resolveAsync(await element.type(element.props))
  const next: Record<string, unknown> = {}
  let changed = false
  for (const [key, value] of Object.entries(element.props ?? {})) {
    if (isValidElement(value) || Array.isArray(value)) {
      next[key] = await resolveAsync(value as ReactNode)
      changed = true
    }
  }
  return changed ? cloneElement(element, next) : element
}
