import { createQuoteFromTemplateSystem, findQuoteByAutomationKeyQuery } from '@/db/quotes/quotes'
import { getQuoteTemplateSystem } from '@/db/quotes/templates'
import { getLeadHandlerId } from '@/db/automations/leadFacts'
import { sendOnceKey } from '../laws'
import type { ActionExecutor, ExecutionContext, PreflightResult } from './types'

/**
 * `quote.create` — Action #4, and the first that writes a SALES record.
 *
 * Everything about quotes lives in the quotation domain; what is here is only
 * the part that is genuinely the ACTION's: which template, who owns the result,
 * and what to do when the configuration can no longer produce one. The domain
 * knows nothing about automations — the dependency points one way, and the only
 * thing crossing is an opaque idempotency string.
 *
 * INTERNAL, by design. Nothing reaches the customer: a draft is prepared and
 * left for the rep. That is what lets the catalog entry declare `send_once` and
 * nothing else, and it is why a suppressed lead still gets one.
 *
 * THE HARD PART IS IDEMPOTENCY. Unlike every action before it, `execute` here
 * WRITES. The engine's contract is that a throw releases the send-once claim and
 * the job retries — which for a writing action would mean a second quote. The
 * guard is a partial unique index on (agencyId, automationKey) and a
 * conflict-ignore insert, so a retry converges on the row that already exists
 * rather than racing to make another. The key is the engine's OWN
 * `sendOnceKey(automationId, leadId)`, not a second scheme.
 */

export type QuoteReady = {
  templateId: number
  /** Who the quote belongs to. A quote with no owner has nobody to chase it. */
  ownerUserId: number
  /** The template's picker label, for the activity row. */
  templateName: string
  /** A quote this automation already produced for this lead, if any. */
  existingQuoteId: number | null
}

export type QuoteDeps = {
  handlerId: (agencyId: number, leadId: number) => Promise<number | null>
  loadTemplate: typeof getQuoteTemplateSystem
  findExisting: (agencyId: number, automationKey: string) => Promise<number | null>
  createQuote: typeof createQuoteFromTemplateSystem
}

const asId = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

export const quoteExecutor: ActionExecutor<QuoteReady, QuoteDeps> = {
  actionKey: 'quote.create',
  /**
   * Nothing here substitutes a variable: the quote's content comes from the
   * template's stored items, and a price is never assembled from a token. An
   * empty set is the honest declaration, and it is what `manage.ts` validates
   * authored content against — of which this action has none.
   */
  resolvableFields: [],

  defaultDeps: () => ({
    handlerId: getLeadHandlerId,
    loadTemplate: getQuoteTemplateSystem,
    findExisting: async (agencyId, automationKey) => {
      const row = (await findQuoteByAutomationKeyQuery(agencyId, automationKey)) as { id: number } | undefined
      return row ? Number(row.id) : null
    },
    createQuote: createQuoteFromTemplateSystem,
  }),

  /**
   * Everything that can be wrong with the SETUP is decided here, before the
   * send-once claim (ADR-013) — a misconfigured automation is the business's
   * fault, and burning the lead's once-ever allowance on it would mean they
   * never get a quote even after it is fixed.
   *
   * Three faults, each named rather than collapsed into "failed": no template
   * chosen, the template gone or withdrawn, and no rep to own the result.
   */
  async preflight(ctx: ExecutionContext, deps: QuoteDeps): Promise<PreflightResult<QuoteReady>> {
    const problem = (reason: string) => ({
      ready: null,
      problem: { reason, deadReason: reason, warnTransition: 'quote_incomplete', logClass: 'quote_config' },
    })

    const templateId = asId(ctx.parameters.quoteTemplateId)
    if (!templateId) return problem('template_not_chosen')

    /**
     * Re-read at EXECUTION time, never trusted from configuration time. A
     * template can be archived or emptied long after an automation was built,
     * and `getQuoteTemplateSystem` refuses both — so a withdrawn price cannot be
     * quoted by an automation configured months earlier.
     */
    const template = await deps.loadTemplate(ctx.agencyId, templateId)
    if (!template) return problem('template_unavailable')

    const ownerUserId = await deps.handlerId(ctx.agencyId, ctx.leadId)
    if (!ownerUserId) return problem('no_handler')

    const existingQuoteId = await deps.findExisting(ctx.agencyId, sendOnceKey(ctx.automationId, ctx.leadId))

    return {
      ready: { templateId, ownerUserId, templateName: template.template.name, existingQuoteId },
      problem: null,
    }
  },

  async execute(ctx: ExecutionContext, ready: QuoteReady, deps: QuoteDeps) {
    if (ctx.mode !== 'live') {
      /**
       * Observation mode (ADR-009): the whole path above ran — template loaded,
       * still usable, owner resolved — and only the effect is withheld. A
       * `would_send` that wrote a `sales_quotes` row would make every pilot
       * metric a lie about what the engine did.
       */
      return {
        kind: 'would_send' as const,
        summary: ready.templateName,
        log: { reason: 'log_mode', templateId: ready.templateId },
      }
    }

    const res = await deps.createQuote({
      agencyId: ctx.agencyId,
      leadId: ctx.leadId,
      templateId: ready.templateId,
      // The lead's handler authors it, exactly as `task.create` assigns to them.
      createdByUserId: ready.ownerUserId,
      // The engine's own once-ever key. The unique index on it is what makes a
      // retry after a partial failure converge instead of duplicating.
      automationKey: sendOnceKey(ctx.automationId, ctx.leadId),
    })

    if ('reason' in res) {
      /**
       * Throwing releases the claim and lets the job retry — correct for every
       * reason that can reach here. `conflict_unresolved` is a race worth
       * retrying; `lead_not_found` means the lead was deleted since the law
       * layer checked, and the retry will exhaust into a dead job with a visible
       * failure rather than a silent nothing.
       */
      throw new Error(`quote: ${res.reason}`)
    }

    return {
      kind: 'sent' as const,
      summary: ready.templateName,
      log: {
        reason: res.created ? 'quote_created' : 'quote_already_present',
        quoteId: res.quoteId,
        templateId: ready.templateId,
      },
    }
  },

  /**
   * No test send (`testable: false`). There is no inert recipient for a quote —
   * a test would put a real draft on a real lead, which is not a test.
   */
  test: undefined,
}
