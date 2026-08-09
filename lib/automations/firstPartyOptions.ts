import { listQuoteTemplatesSystem } from '@/db/quotes/templates'
import { FIRST_PARTY_SOURCES, type FirstPartySource } from './catalog/vocabularies'
import type { ConnectionOption } from './catalog/types'

/**
 * FIRST-PARTY OPTION SOURCES — the agency's own data, as automation parameter
 * options.
 *
 * The sibling of `connectors/registry.ts`, and deliberately NOT part of it. The
 * Connection layer answers "what does this integration hold for this agency";
 * this answers "what does this agency hold". Every `enum_remote` door ends at
 * `providerForConnection(connectionId)` and returns `[]` without one, so
 * agency-owned data has no honest route through it.
 *
 * DEPENDENCY DIRECTION. This module imports FROM the quote domain. The quote
 * domain imports nothing from `lib/automations/**` — enforced by test — so the
 * arrow only ever points this way:
 *
 *     Builder → Server Action → this registry → quote domain
 *
 * ONE SOURCE OF TRUTH. `quote_templates` resolves through
 * `listQuoteTemplatesSystem`, the same primitive a future `quote.create`
 * executor's preflight reaches through `getQuoteTemplateSystem`. Both are
 * active-only, so archiving a template removes it from the Builder's picker and
 * from the executor in one act.
 *
 * NOT A FRAMEWORK: one lookup table, one shape, one entry today.
 */

/**
 * `Record<FirstPartySource, …>` is exhaustive by construction — the
 * `LAW_EVALUATORS` pattern. Adding a key to `FIRST_PARTY_SOURCES` without a
 * loader here is a COMPILE error rather than an empty dropdown a customer would
 * read as "you have none".
 */
const LOADERS: Record<FirstPartySource, (agencyId: number) => Promise<ConnectionOption[]>> = {
  quote_templates: async (agencyId) => {
    // `{id, name}` in, `{id, label}` out — the same generic pair every
    // connector-backed picker returns, so the Builder renders one control.
    const templates = await listQuoteTemplatesSystem(agencyId)
    return templates.map((t) => ({ id: String(t.id), label: t.name }))
  },
}

/** Whether a caller-supplied key names a registered first-party source. */
export function isFirstPartySource(value: unknown): value is FirstPartySource {
  return typeof value === 'string' && (FIRST_PARTY_SOURCES as readonly string[]).includes(value)
}

/**
 * Options for one first-party source.
 *
 * An unregistered key yields `[]` rather than throwing — Law 3, the same posture
 * `optionsFor` takes for an unknown connector source. The Server Action refuses
 * unknown keys *before* reaching here, so this is the second layer, not the only
 * one.
 */
export async function firstPartyOptionsFor(agencyId: number, optionSource: string): Promise<ConnectionOption[]> {
  if (!Number.isInteger(agencyId) || agencyId <= 0) return []
  if (!isFirstPartySource(optionSource)) return []
  return LOADERS[optionSource](agencyId)
}

/** Every source that can actually resolve today. CI pins this against the vocabulary. */
export function registeredFirstPartySources(): readonly string[] {
  return Object.keys(LOADERS)
}
