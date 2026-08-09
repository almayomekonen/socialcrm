import type { Knex } from 'knex'
import { db } from '@/config/db'

/**
 * Quote template reads — the price authority.
 *
 * SYSTEM-LEVEL BY CONSTRUCTION. Every function takes an explicit `agencyId` and
 * derives no session. This is a deliberate divergence from `db/billing/*`, which
 * calls `requireUser()` inside each function — and that is precisely why the
 * automation worker cannot reuse the billing data layer: a cron worker has no
 * cookie. Taking the tenant as an argument is what lets ONE implementation serve
 * both the interactive path (a Server Action resolves `agencyId` from the
 * session and passes it down) and the worker path.
 *
 * The contract that makes that safe: `agencyId` must come from a
 * server-established source — `requireUser().agencyId` for the interactive path,
 * the automation job row for the worker path. It is never accepted from the wire.
 *
 * Query builders are exported alongside their awaited forms so the storage
 * contract can be pinned with `.toSQL()` shape tests — the repo's pattern for a
 * data layer whose DB-backed harness cannot run.
 */

export type QuoteTemplateState = 'active' | 'archived'

export type SalesQuoteTemplateRow = {
  id: number
  agencyId: number
  createdByUserId: number
  name: string
  title: string
  introText: string
  termsText: string
  currency: string
  locale: string
  validityDays: number
  state: QuoteTemplateState
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type SalesQuoteTemplateItemRow = {
  id: number
  templateId: number
  agencyId: number
  lineNumber: number
  title: string
  description: string
  quantity: number
  unitPrice: number
  discount: number
  isOptional: boolean
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type QuoteTemplateWithItems = {
  template: SalesQuoteTemplateRow
  items: SalesQuoteTemplateItemRow[]
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function normalizeTemplate(raw: Record<string, unknown>): SalesQuoteTemplateRow {
  return {
    id: Number(raw.id),
    agencyId: Number(raw.agencyId),
    createdByUserId: Number(raw.createdByUserId),
    name: String(raw.name ?? ''),
    title: String(raw.title ?? ''),
    introText: String(raw.introText ?? ''),
    termsText: String(raw.termsText ?? ''),
    currency: String(raw.currency ?? 'ILS'),
    locale: String(raw.locale ?? 'he'),
    validityDays: num(raw.validityDays),
    state: (raw.state as QuoteTemplateState) ?? 'active',
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
    createdAt: String(raw.createdAt),
    updatedAt: String(raw.updatedAt),
  }
}

function normalizeItem(raw: Record<string, unknown>): SalesQuoteTemplateItemRow {
  return {
    id: Number(raw.id),
    templateId: Number(raw.templateId),
    agencyId: Number(raw.agencyId),
    lineNumber: num(raw.lineNumber),
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    quantity: num(raw.quantity),
    unitPrice: num(raw.unitPrice),
    discount: num(raw.discount),
    isOptional: Boolean(raw.isOptional),
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
    createdAt: String(raw.createdAt),
    updatedAt: String(raw.updatedAt),
  }
}

/** The picker's list: active templates for one agency, by name. */
export function listActiveQuoteTemplatesQuery(agencyId: number, executor: Knex | Knex.Transaction = db) {
  return executor('sales_quote_templates').where({ agencyId, state: 'active' }).orderBy('name', 'asc')
}

/**
 * The SELECTION primitive — what a picker needs and nothing more.
 *
 * `{ id, name }` only. The future Automation Builder resolves a
 * `quoteTemplateId` through its own Server Action, which calls this; handing it
 * whole template rows would ship prices and terms into a Builder that has no
 * use for them, and would make the contract harder to keep stable than the two
 * fields a dropdown actually renders.
 *
 * ACTIVE ONLY. An archived template must not be selectable for new
 * configuration — that is what archiving means. Existing quotes are unaffected
 * because they hold snapshots, not references.
 */
export type QuoteTemplateOption = { id: number; name: string }

export async function listQuoteTemplatesSystem(
  agencyId: number,
  executor: Knex | Knex.Transaction = db,
): Promise<QuoteTemplateOption[]> {
  if (!Number.isInteger(agencyId) || agencyId <= 0) return []
  const rows = (await listActiveQuoteTemplatesQuery(agencyId, executor).select('id', 'name')) as Array<{
    id: number
    name: string
  }>
  return rows.map((r) => ({ id: Number(r.id), name: String(r.name ?? '') }))
}

export async function listActiveQuoteTemplates(agencyId: number): Promise<SalesQuoteTemplateRow[]> {
  const rows = await listActiveQuoteTemplatesQuery(agencyId)
  return (rows as Record<string, unknown>[]).map(normalizeTemplate)
}

export function getQuoteTemplateQuery(agencyId: number, templateId: number, executor: Knex | Knex.Transaction = db) {
  return executor('sales_quote_templates').where({ id: templateId, agencyId }).first()
}

export function listQuoteTemplateItemsQuery(
  agencyId: number,
  templateId: number,
  executor: Knex | Knex.Transaction = db,
) {
  return executor('sales_quote_template_items').where({ agencyId, templateId }).orderBy('lineNumber', 'asc')
}

/**
 * Load a template and its items for USE — the primitive the future
 * `quote.create` executor calls before building a quote.
 *
 * Returns null rather than throwing for every "cannot be used" case: wrong
 * agency, missing, or archived. The caller decides what that means — for an
 * automation it is a preflight problem (a configuration fault, definitive and
 * never retried); for the UI it is a validation message.
 *
 * ARCHIVED IS NOT USABLE. A business archives a template to stop offering it;
 * honouring that at read time is what stops an automation configured months ago
 * from quoting a price that was deliberately withdrawn.
 */
export async function getQuoteTemplateSystem(
  agencyId: number,
  templateId: number,
  executor: Knex | Knex.Transaction = db,
): Promise<QuoteTemplateWithItems | null> {
  if (!Number.isInteger(agencyId) || agencyId <= 0) return null
  if (!Number.isInteger(templateId) || templateId <= 0) return null

  const raw = (await getQuoteTemplateQuery(agencyId, templateId, executor)) as Record<string, unknown> | undefined
  if (!raw) return null

  const template = normalizeTemplate(raw)
  if (template.state !== 'active') return null

  const itemRows = (await listQuoteTemplateItemsQuery(agencyId, templateId, executor)) as Record<string, unknown>[]
  const items = itemRows.map(normalizeItem)

  // A template with no lines quotes nothing. Treating it as unusable here is
  // what stops an empty quote reaching a customer — the alternative failure
  // mode being a ₪0 offer, which is worse than no offer.
  if (items.length === 0) return null

  return { template, items }
}
