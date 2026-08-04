import { loadTemplateForSend, type TemplateSendRow } from '@/db/whatsappTemplates'
import { resolveWhatsappOutboundTarget, type WhatsappOutboundTarget } from '@/lib/inbox/whatsappOutboundTarget'
import { resolveTemplateMessage, templateSlots } from '../whatsapp/templateParams'
import type {
  ActionExecutor,
  ExecutionContext,
  PreflightResult,
  PreviewResult,
  PreviewTarget,
  TestResult,
  TestTarget,
} from './types'

/**
 * `whatsapp.send` — Action #3, and NOT a second WhatsApp system.
 *
 * Every line that talks to Meta, resolves a token, or writes a conversation row
 * lives in the services this file calls. What is here is only the part that is
 * genuinely the ACTION's: which template, which slots, and what to do when the
 * configuration cannot produce a legal send.
 *
 * TEMPLATE-ONLY, by the audit's decisive conclusion. An automation is
 * business-initiated and usually delayed — a reminder a day early, a follow-up a
 * week late — so Meta's 24-hour customer-service window is normally CLOSED, and
 * a free-text send would fail for most automations most of the time while
 * succeeding for the occasional lead who happened to message recently. That is a
 * product that works sometimes, which is worse than one that says what it does.
 * An approved template delivers either way, so the window stops being a variable
 * and `window_24h` never needs to gate this action (laws.ts says so at the
 * evaluator).
 *
 * There is no `body` parameter anywhere below. The template IS the content.
 */

/**
 * Subject fields an automation may bind a template slot to.
 *
 * The AUTHORITY for slot mapping, exactly as `email.send`'s list is the
 * authority for what its body may reference. Wider than the rep-facing chip set
 * because an automation knows things a rep composing by hand does not — above
 * all the appointment's meeting, which is the reason the reminder automation
 * exists.
 */
const RESOLVABLE_FIELDS = [
  'leadFirstName',
  'businessName',
  'repName',
  'meetingTitle',
  'meetingWhen',
  'meetingDetails',
] as const

/** What preflight proved and execute may rely on. */
export type WhatsappReady = {
  template: TemplateSendRow
  target: WhatsappOutboundTarget
  params: string[]
  /** The message as the lead will read it — persisted to the conversation. */
  text: string
}

export type WhatsappDeps = {
  loadTemplate: (templateId: number, agencyId: number) => Promise<TemplateSendRow | null>
  resolveTarget: typeof resolveWhatsappOutboundTarget
  send: (args: {
    phoneNumberId: string
    accessToken: string
    to: string
    name: string
    language: string
    params: string[]
  }) => Promise<{ ok: true; wamid: string } | { ok: false; error: string; code?: string }>
  persist: (args: {
    agencyId: number
    leadId: number
    businessPhoneNumberId: string
    customerWaId: string
    customerName: string | null
    sentByUserId: number | null
    wamid: string
    text: string
  }) => Promise<unknown>
}

const asId = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** The slot bindings the Builder stored, as `{ "1": "leadFirstName" }`. */
const bindingsFrom = (parameters: Record<string, unknown>): Record<string, string> => {
  const raw = parameters.templateBindings
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [position, field] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof field === 'string' && field) out[position] = field
  }
  return out
}

export const whatsappExecutor: ActionExecutor<WhatsappReady, WhatsappDeps> = {
  actionKey: 'whatsapp.send',
  resolvableFields: RESOLVABLE_FIELDS,

  defaultDeps: () => ({
    loadTemplate: loadTemplateForSend,
    resolveTarget: resolveWhatsappOutboundTarget,
    // Transport and persistence are effect-time concerns (ADR-011), loaded
    // lazily so a log-mode pass never reaches the Graph client.
    send: async (args) => {
      const { sendWhatsappTemplate } = await import('@/lib/whatsapp/sendTemplateMessage')
      const res = await sendWhatsappTemplate(args)
      return 'error' in res ? { ok: false as const, error: res.error, code: res.code } : { ok: true as const, wamid: res.wamid }
    },
    persist: async (args) => {
      const { persistOutboundWhatsapp } = await import('@/lib/inbox/persistOutboundWhatsapp')
      return persistOutboundWhatsapp(args)
    },
  }),

  /**
   * Everything that can be wrong with the SETUP is decided here, before the
   * send-once claim (ADR-013) — because a misconfigured automation is the
   * business's fault, and burning the lead's once-ever allowance on it would
   * mean the lead never receives the message even after it is fixed.
   *
   * Four distinct faults, each named rather than collapsed into "failed":
   * no template chosen, template gone or not approved, no WhatsApp destination,
   * and slots we cannot fill.
   */
  async preflight(ctx: ExecutionContext, deps: WhatsappDeps): Promise<PreflightResult<WhatsappReady>> {
    const problem = (reason: string, deadReason = reason) => ({
      ready: null,
      problem: { reason, deadReason, warnTransition: 'whatsapp_incomplete', logClass: 'whatsapp_config' },
    })

    const templateId = asId(ctx.parameters.templateId)
    if (!templateId) return problem('template_not_chosen')

    const template = await deps.loadTemplate(templateId, ctx.agencyId)
    if (!template) return problem('template_missing')
    /**
     * Approval is re-checked at SEND time, not trusted from configuration time.
     * Meta can reject, pause or disable a template long after an automation was
     * built, and the template registry already tracks that — so the only wrong
     * thing to do is assume the status held.
     */
    if (template.status !== 'approved') return problem(`template_not_approved:${template.status}`)

    const resolved = await deps.resolveTarget(ctx.agencyId, ctx.leadId)
    if ('reason' in resolved) return problem(`no_target:${resolved.reason}`)

    const message = resolveTemplateMessage(template, bindingsFrom(ctx.parameters), ctx.subject, RESOLVABLE_FIELDS)
    if ('positions' in message) {
      // Mismatched parameter counts are what Meta's #132000 is; refusing here is
      // what makes that class of failure unreachable rather than retried.
      return problem(`template_unmapped:${message.positions.join(',')}`)
    }

    return {
      ready: { template, target: resolved.target, params: message.params, text: message.text },
      problem: null,
    }
  },

  async execute(ctx: ExecutionContext, ready: WhatsappReady, deps: WhatsappDeps) {
    if (ctx.mode !== 'live') {
      // Observation mode (ADR-009): the whole path above ran — template loaded,
      // approval confirmed, target resolved, parameters resolved — and only the
      // external effect is withheld. That is what makes a log-mode pass real
      // evidence rather than a rehearsal.
      return {
        kind: 'would_send' as const,
        summary: ready.text,
        log: { reason: 'log_mode', template: ready.template.name, params: ready.params.length },
      }
    }

    const sent = await deps.send({
      phoneNumberId: ready.target.businessPhoneNumberId,
      accessToken: ready.target.accessToken,
      to: ready.target.customerWaId,
      name: ready.template.name,
      language: ready.template.language,
      params: ready.params,
    })
    // Throwing releases the claim and lets the job retry — correct for a
    // transport failure, which is exactly what this is.
    if ('error' in sent) throw new Error(`whatsapp: ${sent.code ?? ''} ${sent.error}`.trim())

    /**
     * Persisted AFTER a confirmed wamid, never before — the same discipline the
     * two existing send callers keep, so a failed Cloud API call can never leave
     * a fake message in the conversation.
     *
     * `sentByUserId: null` is deliberate and load-bearing: it marks the message
     * as the SYSTEM's, which is both true and what stops the instant-response
     * engine from reading it as "a human replied".
     */
    await deps.persist({
      agencyId: ctx.agencyId,
      leadId: ctx.leadId,
      businessPhoneNumberId: ready.target.businessPhoneNumberId,
      customerWaId: ready.target.customerWaId,
      customerName: ready.target.customerName,
      sentByUserId: null,
      wamid: sent.wamid,
      text: ready.text,
    })

    return {
      kind: 'sent' as const,
      summary: ready.text,
      // The statuses webhook takes it from here: sent → delivered → read.
      deliveryState: 'sent' as const,
      providerMessageId: sent.wamid,
      log: { reason: 'transport_accepted', providerMessageId: sent.wamid, template: ready.template.name },
    }
  },

  /**
   * The Builder preview — resolved by the SAME code as a real send, so what the
   * customer approves is what a lead receives.
   *
   * Sample values stand in for the lead's, because a preview has no lead. An
   * unmapped template previews as a failure rather than as plausible text: the
   * customer needs to learn it cannot be sent HERE, while they are editing it.
   */
  async preview(parameters, target: PreviewTarget, deps: WhatsappDeps): Promise<PreviewResult> {
    const templateId = asId(parameters.templateId)
    if (!templateId) return { ok: false, reason: 'template_not_chosen' }
    const template = await deps.loadTemplate(templateId, target.agencyId)
    if (!template) return { ok: false, reason: 'template_missing' }

    const message = resolveTemplateMessage(template, bindingsFrom(parameters), sampleSubject(target.toName), RESOLVABLE_FIELDS)
    if ('positions' in message) return { ok: false, reason: `template_unmapped:${message.positions.join(',')}` }

    return { ok: true, shape: 'message', text: message.text, notApproved: template.status !== 'approved' }
  },

  /**
   * "שלח אליי בדיקה" is NOT offered for this action, and the catalog says so
   * (`testable: false`).
   *
   * A WhatsApp test would have to send a real template message to a real phone
   * number that is not a lead's — which costs money per message, consumes the
   * template's quality reputation, and has no inert equivalent of email's
   * lead-0 unsubscribe trick. The Builder preview is the honest substitute: it
   * runs the real resolver, so there is nothing a test send would reveal that
   * the preview does not.
   */
  test: undefined,
}

/** Preview stand-ins. Shaped like a real subject so the resolver is unchanged. */
function sampleSubject(toName: string | null): Record<string, unknown> {
  return {
    leadFirstName: toName ?? 'דוד',
    businessName: 'העסק שלי',
    repName: toName ?? 'אבי',
    meetingTitle: 'פגישת ייעוץ',
    meetingWhen: 'יום שלישי, 12.8, בשעה 10:30',
    meetingDetails: 'פגישת ייעוץ · יום שלישי, 12.8, בשעה 10:30',
  }
}

/** Declared for the type; `test` is intentionally absent (see above). */
export type { TestResult, TestTarget }
