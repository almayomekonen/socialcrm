import type { Knex } from 'knex'
import { db } from '@/config/db'
import { computeQuoteTotals } from '@/lib/quotes/totals'
import {
  validateQuoteTemplateDraft,
  withDenseLineNumbers,
  type QuoteTemplateDraft,
  type QuoteTemplateIssue,
} from '@/lib/quotes/templateValidation'
import {
  listQuoteTemplateItemsQuery,
  type QuoteTemplateState,
  type SalesQuoteTemplateItemRow,
  type SalesQuoteTemplateRow,
} from './templates'

/**
 * Quote-template management — reads for the settings list, and the writes.
 *
 * Split from `templates.ts`, which owns the USE path (`getQuoteTemplateSystem`
 * and the selection primitive). The two have genuinely different audiences: one
 * is read by a quote being created, the other by an admin editing a price list.
 * Keeping them apart stops the read path that automations will depend on from
 * growing management concerns.
 *
 * SYSTEM-LEVEL, like every other quote module: explicit `agencyId`, no session.
 * The Server Actions in `actions/quotes/templates.ts` resolve the tenant from
 * the session and pass it down; `agencyId` is never accepted from the wire.
 *
 * NOTE ON SIZE (architecture-rules §1/§6): over the 250-line soft limit and
 * intentionally so. The reads and the writes here are one concern — managing a
 * template — and they share the shaping logic in `loadQuoteTemplateWorkspace`,
 * which exists precisely so the list and the editor cannot disagree about a
 * template's value. Separating them would duplicate that shaping or export it
 * to a third module for two callers. Result types and doc comments account for
 * most of the length. The extraction to make when it grows again is the
 * workspace loader moving to `db/quotes/templateWorkspace.ts`.
 */

export type QuoteTemplateOverview = {
  id: number
  name: string
  title: string
  state: QuoteTemplateState
  validityDays: number
  itemCount: number
  optionalItemCount: number
  /** Binding-line value, excluding VAT. Optional lines are excluded. */
  subtotalAmount: number
  updatedAt: string
}

export type QuoteTemplateEditView = {
  template: SalesQuoteTemplateRow
  items: SalesQuoteTemplateItemRow[]
}

export type SaveQuoteTemplateFailure = QuoteTemplateIssue | 'invalid_input' | 'not_found' | 'name_taken'

export type SaveQuoteTemplateResult = { ok: true; templateId: number } | { ok: false; reason: SaveQuoteTemplateFailure }

export type SetTemplateStateResult = { ok: true } | { ok: false; reason: 'not_found' | 'name_taken' | 'invalid_input' }

/** Postgres unique violation — the active-name index is the only one reachable here. */
const isUniqueViolation = (err: unknown): boolean => (err as { code?: string })?.code === '23505'

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

// ── Reads ───────────────────────────────────────────────────────────────────

export function listAllQuoteTemplatesQuery(agencyId: number, executor: Knex | Knex.Transaction = db) {
  // Archived rows included: the management list is where archiving is undone,
  // so hiding them would strand every archived template permanently.
  return executor('sales_quote_templates').where({ agencyId }).orderBy([
    { column: 'state', order: 'asc' },
    { column: 'name', order: 'asc' },
  ])
}

export function listAllQuoteTemplateItemsQuery(agencyId: number, executor: Knex | Knex.Transaction = db) {
  return executor('sales_quote_template_items').where({ agencyId }).orderBy('lineNumber', 'asc')
}

/** The full editable document — what the editor round-trips. */
export type QuoteTemplateDocument = QuoteTemplateDraft & { id: number }

export type QuoteTemplateWorkspace = {
  overviews: QuoteTemplateOverview[]
  /** Keyed by template id, so opening the editor needs no second round trip. */
  documents: Record<number, QuoteTemplateDocument>
}

/**
 * Everything the settings page renders, from TWO queries.
 *
 * The list and the editor need the same rows — the list wants counts and a
 * value, the editor wants the whole document — so they are read once and shaped
 * twice here rather than fetched separately by the page.
 *
 * Values are grouped in memory, NOT aggregated in SQL. Money arithmetic has
 * exactly one implementation in this codebase and it is `lib/billing/totals.ts`;
 * a `SUM(quantity * "unitPrice" - discount)` here would be a second one, free to
 * disagree with the editor's figure over rounding. An agency has tens of
 * templates, so the cost is nil and the guarantee is total.
 */
export async function loadQuoteTemplateWorkspace(agencyId: number): Promise<QuoteTemplateWorkspace> {
  if (!Number.isInteger(agencyId) || agencyId <= 0) return { overviews: [], documents: {} }

  const [templates, items] = await Promise.all([
    listAllQuoteTemplatesQuery(agencyId) as Promise<Record<string, unknown>[]>,
    listAllQuoteTemplateItemsQuery(agencyId) as Promise<Record<string, unknown>[]>,
  ])

  const byTemplate = new Map<number, Record<string, unknown>[]>()
  for (const item of items) {
    const key = Number(item.templateId)
    const bucket = byTemplate.get(key)
    if (bucket) bucket.push(item)
    else byTemplate.set(key, [item])
  }

  const overviews: QuoteTemplateOverview[] = []
  const documents: Record<number, QuoteTemplateDocument> = {}

  for (const t of templates) {
    const id = Number(t.id)
    // Ordered by lineNumber at the query; the editor reorders by array position.
    const own = byTemplate.get(id) ?? []
    const drafted = own.map((i) => ({
      title: String(i.title ?? ''),
      description: String(i.description ?? ''),
      quantity: num(i.quantity),
      unitPrice: num(i.unitPrice),
      discount: num(i.discount),
      isOptional: Boolean(i.isOptional),
    }))

    // Rate 0: a template holds no tax, so its value is stated before VAT. The
    // rate is applied at quote creation from the agency's live policy.
    const totals = computeQuoteTotals(drafted.map((i) => ({ ...i, taxRatePercentSnapshot: 0 })))

    overviews.push({
      id,
      name: String(t.name ?? ''),
      title: String(t.title ?? ''),
      state: (t.state as QuoteTemplateState) ?? 'active',
      validityDays: num(t.validityDays),
      itemCount: drafted.length,
      optionalItemCount: drafted.filter((i) => i.isOptional).length,
      subtotalAmount: totals.subtotalAmount,
      updatedAt: String(t.updatedAt),
    })

    documents[id] = {
      id,
      name: String(t.name ?? ''),
      title: String(t.title ?? ''),
      introText: String(t.introText ?? ''),
      termsText: String(t.termsText ?? ''),
      validityDays: num(t.validityDays),
      items: drafted,
    }
  }

  return { overviews, documents }
}

/**
 * Load a template for EDITING — archived included.
 *
 * Deliberately not `getQuoteTemplateSystem`, which refuses archived and
 * item-less templates because it answers "may this be used to build a quote".
 * Editing an archived template in order to restore it is exactly the case that
 * read path is right to reject and this one is right to allow.
 */
export async function getQuoteTemplateForEdit(agencyId: number, templateId: number): Promise<QuoteTemplateEditView | null> {
  if (!Number.isInteger(agencyId) || agencyId <= 0) return null
  if (!Number.isInteger(templateId) || templateId <= 0) return null

  const raw = (await db('sales_quote_templates').where({ id: templateId, agencyId }).first()) as
    | Record<string, unknown>
    | undefined
  if (!raw) return null

  const items = (await listQuoteTemplateItemsQuery(agencyId, templateId)) as Record<string, unknown>[]
  return {
    template: raw as unknown as SalesQuoteTemplateRow,
    items: items as unknown as SalesQuoteTemplateItemRow[],
  }
}

// ── Writes ──────────────────────────────────────────────────────────────────

export type SaveQuoteTemplateInput = {
  agencyId: number
  createdByUserId: number
  /** Absent creates; present updates, after an ownership re-read. */
  templateId?: number | null
  draft: QuoteTemplateDraft
}

/**
 * Create or replace a template and its full item set, atomically.
 *
 * ITEMS ARE REPLACED WHOLESALE rather than diffed, and that is safe precisely
 * because of the snapshot design: a quote copies item VALUES, and
 * `sales_quotes."templateId"` references the template, never an item row. No
 * quote can be broken by deleting a template item, so the simplest correct
 * write is also the correct one. Diffing would buy nothing and could leave a
 * template half-updated on a partial failure.
 *
 * Line numbers are assigned here from array order — never taken from the
 * caller, so a duplicate or a gap cannot reach the unique index.
 */
export async function saveQuoteTemplateSystem(input: SaveQuoteTemplateInput): Promise<SaveQuoteTemplateResult> {
  const { agencyId, createdByUserId } = input
  if (![agencyId, createdByUserId].every((n) => Number.isInteger(n) && n > 0)) {
    return { ok: false, reason: 'invalid_input' }
  }

  // The same rules the database will apply, run first so the caller gets a
  // named reason instead of a constraint error.
  const issue = validateQuoteTemplateDraft(input.draft)
  if (issue) return { ok: false, reason: issue }

  const draft = input.draft
  const header = {
    name: draft.name.trim(),
    title: (draft.title ?? '').trim(),
    introText: (draft.introText ?? '').trim(),
    termsText: (draft.termsText ?? '').trim(),
    validityDays: draft.validityDays,
  }
  const items = withDenseLineNumbers(draft.items)

  try {
    return await db.transaction(async (trx) => {
      let templateId = input.templateId ?? null

      if (templateId) {
        const updated = await trx('sales_quote_templates')
          .where({ id: templateId, agencyId })
          .update({ ...header, updatedAt: trx.fn.now() })
        if (updated === 0) return { ok: false, reason: 'not_found' as const }
      } else {
        const [row] = await trx('sales_quote_templates')
          .insert({ agencyId, createdByUserId, ...header })
          .returning('id')
        templateId = Number(row.id)
      }

      await trx('sales_quote_template_items').where({ agencyId, templateId }).del()
      await trx('sales_quote_template_items').insert(
        items.map((i) => ({
          templateId,
          agencyId,
          lineNumber: i.lineNumber,
          title: i.title.trim(),
          description: (i.description ?? '').trim(),
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          discount: i.discount,
          isOptional: Boolean(i.isOptional),
        })),
      )

      return { ok: true, templateId: templateId as number }
    })
  } catch (err) {
    // Only the active-name partial unique index can fire here.
    if (isUniqueViolation(err)) return { ok: false, reason: 'name_taken' }
    throw err
  }
}

/**
 * Archive or restore.
 *
 * SOFT ONLY — there is no delete. `sales_quotes."templateId"` records where a
 * quote came from, and hard deletion would erase the provenance of quotes
 * already sent to customers. Archiving is also what removes a template from the
 * selection primitive, so a withdrawn price stops being offerable without any
 * existing quote changing.
 *
 * Restoring can legitimately fail: the active-name index is partial, so a name
 * freed by archiving may have been reused since. `name_taken` says so rather
 * than surfacing a constraint error.
 */
export async function setQuoteTemplateStateSystem(
  agencyId: number,
  templateId: number,
  state: QuoteTemplateState,
): Promise<SetTemplateStateResult> {
  if (!Number.isInteger(agencyId) || agencyId <= 0) return { ok: false, reason: 'invalid_input' }
  if (!Number.isInteger(templateId) || templateId <= 0) return { ok: false, reason: 'invalid_input' }
  if (state !== 'active' && state !== 'archived') return { ok: false, reason: 'invalid_input' }

  try {
    const updated = await db('sales_quote_templates')
      .where({ id: templateId, agencyId })
      .update({ state, updatedAt: db.fn.now() })
    return updated === 0 ? { ok: false, reason: 'not_found' } : { ok: true }
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, reason: 'name_taken' }
    throw err
  }
}
