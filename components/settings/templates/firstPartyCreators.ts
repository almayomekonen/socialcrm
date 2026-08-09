import type { ComponentType } from 'react'
import type { FirstPartySource } from '@/lib/automations/catalog/vocabularies'
import type { TemplateVariable } from '@/lib/automations/templates/types'

/**
 * INLINE CREATORS — first-party data a template variable can BUILD, not only pick.
 *
 * An `enum_agency` variable normally renders as a dropdown over data the agency
 * already has. That is exactly wrong for a first install, where the agency has
 * none: a customer installing their first quotation automation would be sent to
 * settings to create a price list before the automation they came for could
 * exist.
 *
 * A creator is the richer control for that case — it offers what exists AND
 * builds a new one in place. Registered per FIRST-PARTY SOURCE, never per
 * template or per action, so the installer stays the shared shell it has always
 * been and picks the control from catalog data. The registry has exactly the
 * shape `firstPartyOptions.ts` uses for loaders, for the same reason.
 *
 * A source with no creator keeps the plain picker. Nothing regresses by omission.
 */

/**
 * Run by the installer BEFORE it installs, to turn whatever the creator holds
 * into the variable's value — an id already chosen, or one the save produces.
 *
 * Returning a reason rather than throwing keeps the failure visible in the
 * dialog's own error line, in the customer's language.
 */
export type InlineResolver = () => Promise<{ ok: true; value: string } | { ok: false; reason: string }>

export type InlineCreatorProps = {
  variable: TemplateVariable
  value: string
  onChange: (value: string) => void
  /**
   * Register the step above, or `null` to withdraw it. While a resolver is
   * registered the installer treats the variable as answerable, so the button
   * stays live and the resolver — not a disabled control — explains any problem.
   */
  onResolverChange: (resolver: InlineResolver | null) => void
}

/**
 * Lazily referenced so the shared dialog does not pull a quotation editor into
 * its bundle for the five templates that have nothing to do with quotes.
 */
export const FIRST_PARTY_CREATORS: Partial<Record<FirstPartySource, () => Promise<ComponentType<InlineCreatorProps>>>> = {
  quote_templates: () => import('@/components/quotes/QuoteComposer').then((m) => m.default),
}

export const creatorFor = (optionSource: string | undefined) =>
  optionSource ? (FIRST_PARTY_CREATORS[optionSource as FirstPartySource] ?? null) : null
