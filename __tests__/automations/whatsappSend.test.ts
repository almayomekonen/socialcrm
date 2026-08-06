import { describe, expect, it } from 'vitest'
import { catalog, getAction } from '@/lib/automations/catalog/registry'
import { composeLawPipeline, decideSendForAction, type SendFacts } from '@/lib/automations/laws'
import { LAW_KEYS } from '@/lib/automations/catalog/vocabularies'
import { SKIP_REASON_COPY } from '@/lib/automations/copy'
import { recipientFieldFor } from '@/lib/automations/subject'
import { leadMessagesTodayFor } from '@/lib/automations/workerFacts'
import { resolveTemplateMessage, sanitizeParam, templateSlots, unmappedSlots } from '@/lib/automations/whatsapp/templateParams'
import type { WorkerDeps } from '@/lib/automations/workerDeps'
import type { AutomationJob } from '@/db/automations/jobs'

/**
 * `whatsapp.send` — the DECLARATION and the pure logic around it.
 *
 * The executor's own behaviour is in whatsappExecutor.test.ts. What is asserted
 * here is everything that must be true for the action to be safe BEFORE any code
 * runs: which laws it is bound by, which it deliberately is not, that its
 * recipient can be resolved at all, and that a template's slots are never
 * guessed.
 */

const ACTION = 'whatsapp.send'

describe('the action is declared as the audit specified', () => {
  const action = getAction(ACTION)!

  it('is registered', () => {
    expect(action).toBeDefined()
    expect(action.risk).toBe('external')
  })

  it('reuses the EXISTING WhatsApp connection — it does not invent a new one', () => {
    // The capability WhatsApp already grants for the inbox. A business that
    // connected WhatsApp has, by that act alone, satisfied this action.
    expect(action.requirements).toEqual([
      {
        type: 'connection',
        key: 'whatsapp_connected',
        cta: { label: 'חיבור וואטסאפ', href: '/settings/integrations?section=whatsapp' },
      },
    ])
  })

  it('delivers to a phone, and the catalog can resolve one on every lead event', () => {
    expect(action.requires).toEqual(['phone'])
    // The declaration is worthless unless an event actually carries the field:
    // `requires` resolves by TYPE, and an unresolvable type fails closed.
    for (const event of catalog.events) {
      expect(recipientFieldFor(event, 'phone'), `${event.key} exposes no phone field`).toBe('phone')
    }
  })

  it('is TEMPLATE-ONLY — there is no free-text body to send', () => {
    const keys = action.parameters.map((p) => p.key)
    expect(keys).toContain('templateId')
    expect(keys).not.toContain('body')
    expect(keys).not.toContain('subject')
    const template = action.parameters.find((p) => p.key === 'templateId')!
    // The same generic remote picker the form selector uses.
    expect(template.type).toBe('enum_remote')
    expect(template.optionSource).toBe('whatsapp_templates')
    expect(template.validation?.required).toBe(true)
  })

  it('declares every law that protects the lead', () => {
    for (const law of ['send_once', 'per_lead_cap', 'agency_cap', 'opt_out', 'quiet_hours']) {
      expect(action.laws, `missing ${law}`).toContain(law)
    }
  })

  it('declares opt_out rather than suppression — messaging consent is not email consent', () => {
    expect(action.laws).toContain('opt_out')
    // Unsubscribing from a mailing list is not a request to stop WhatsApp, and
    // honouring the wrong one would silence a lead who never asked.
    expect(action.laws).not.toContain('suppression')
  })

  it('does NOT declare window_24h, because a template is immune to the window', () => {
    expect(action.laws).not.toContain('window_24h')
  })

  it('does NOT declare bounce_block — no phone block list exists to consult', () => {
    expect(action.laws).not.toContain('bounce_block')
  })

  it('previews as a message and offers no test send', () => {
    expect(action.preview).toBe('message')
    // A WhatsApp test costs money per message and spends the template's quality
    // rating, and there is no inert recipient the way email has lead 0.
    expect(action.testable).toBe(false)
  })

  it('its whole law pipeline is evaluatable — it can never fail closed by declaration', () => {
    const { unimplemented } = composeLawPipeline(action.laws, action.requires)
    expect(unimplemented).toEqual([])
  })
})

describe('opt_out is implemented, and window_24h is deliberately not', () => {
  it('opt_out now has an evaluator', () => {
    expect(composeLawPipeline(['opt_out'], []).unimplemented).toEqual([])
  })

  it('window_24h is the one law still future', () => {
    const future = LAW_KEYS.filter((k) => composeLawPipeline([k], []).unimplemented.length > 0)
    expect(future).toEqual(['window_24h'])
  })

  it('every skip reason has Hebrew copy, including the new one', () => {
    expect(SKIP_REASON_COPY.opted_out).toBeTruthy()
    expect(SKIP_REASON_COPY.opted_out).not.toContain('אימייל')
  })

  it('the cap copy no longer claims to be about email, because the cap spans channels', () => {
    // A WhatsApp send skipped by the cap used to be explained as an email limit.
    expect(SKIP_REASON_COPY.lead_daily_cap).not.toContain('אימייל')
    expect(SKIP_REASON_COPY.agency_daily_cap).not.toContain('אימייל')
  })
})

const facts = (over: Partial<SendFacts> = {}): SendFacts => ({
  event: { trigger: 'lead_created', origin: 'manual', agencyId: 7, leadId: 42, occurredAt: new Date() },
  lead: { exists: true, currentStatus: 'new' },
  recipients: { phone: { value: '0501234567', blocked: false } },
  suppressed: false,
  optedOut: false,
  alreadySent: false,
  sentToLeadToday: 0,
  sentByAgencyToday: 0,
  now: new Date('2026-08-10T09:00:00Z'),
  ...over,
})

describe('the laws actually stop a WhatsApp send', () => {
  const action = getAction(ACTION)!
  const decide = (f: SendFacts) => decideSendForAction(action, f, () => 'phone')

  it('allows an ordinary send', () => {
    expect(decide(facts())).toEqual({ allow: true })
  })

  it('refuses a lead who asked to stop being messaged', () => {
    expect(decide(facts({ optedOut: true }))).toEqual({ allow: false, reason: 'opted_out' })
  })

  it('an email unsubscribe alone does NOT block WhatsApp', () => {
    // `whatsapp.send` declares no `suppression` law, so email consent is not
    // consulted — the two channels are answered separately and on purpose.
    expect(decide(facts({ suppressed: true }))).toEqual({ allow: true })
  })

  it('refuses when the lead has no phone number', () => {
    expect(decide(facts({ recipients: { phone: { value: null, blocked: false } } }))).toEqual({
      allow: false,
      reason: 'no_phone',
    })
  })

  it('refuses once the lead has hit the daily message cap', () => {
    expect(decide(facts({ sentToLeadToday: 2 }))).toEqual({ allow: false, reason: 'lead_daily_cap' })
  })
})

describe('the per-lead cap counts BOTH automated senders', () => {
  const job = { agencyId: 7, leadId: 42 } as AutomationJob
  const since = new Date('2026-08-10T00:00:00Z')
  const deps = (automations: number, autoResponses: number) =>
    ({
      countLeadToday: async () => automations,
      countAutoResponsesToday: async () => autoResponses,
    }) as unknown as WorkerDeps

  it('sums them — two messages from two subsystems is two messages', async () => {
    expect(await leadMessagesTodayFor(job, since, deps(1, 1))).toBe(2)
  })

  it('an instant-response reply alone can exhaust the cap', async () => {
    // THE double-texting fix: before this, a lead who had just received the
    // instant-response message counted as zero here, so an automation would
    // message them again seconds later.
    const count = await leadMessagesTodayFor(job, since, deps(0, 2))
    expect(count).toBe(2)
    expect(decideSendForAction(getAction(ACTION)!, facts({ sentToLeadToday: count }), () => 'phone')).toEqual({
      allow: false,
      reason: 'lead_daily_cap',
    })
  })

  it('counts nothing when neither sender has acted', async () => {
    expect(await leadMessagesTodayFor(job, since, deps(0, 0))).toBe(0)
  })
})

describe('template slots are resolved, never guessed', () => {
  const chip = { bodyText: 'שלום שם הליד, מדברים מ־שם העסק', variables: [{ token: 'שם הליד', sample: 'דוד' }, { token: 'שם העסק', sample: 'העסק' }] }
  const synced = { bodyText: 'שלום {{1}}, הפגישה שלך ב־{{2}}', variables: [] }
  const subject = { leadFirstName: 'אלמיהו', businessName: 'SocialCRM', meetingWhen: 'יום רביעי בשעה 10:30' }
  const FIELDS = ['leadFirstName', 'businessName', 'repName', 'meetingTitle', 'meetingWhen', 'meetingDetails']

  it('a template authored in SocialCRM needs NO mapping — its chips already mean something', () => {
    expect(templateSlots(chip).map((s) => s.field)).toEqual(['leadFirstName', 'businessName'])
    expect(unmappedSlots(chip)).toEqual([])
  })

  it('orders chip slots by first appearance, matching the approved template', () => {
    // buildComponents numbers {{n}} by first appearance; any other order shifts
    // every parameter by one and Meta rejects the send.
    const reversed = { ...chip, variables: [...chip.variables].reverse() }
    expect(templateSlots(reversed).map((s) => s.label)).toEqual(['שם הליד', 'שם העסק'])
  })

  it('resolves a chip template straight from the subject', () => {
    const res = resolveTemplateMessage(chip, {}, subject, FIELDS)
    expect(res).toMatchObject({ ok: true, params: ['אלמיהו', 'SocialCRM'] })
    expect((res as { text: string }).text).toBe('שלום אלמיהו, מדברים מ־SocialCRM')
  })

  it('a Meta-synced template is UNMAPPED until the customer says what fills it', () => {
    expect(unmappedSlots(synced).map((s) => s.position)).toEqual([1, 2])
    const res = resolveTemplateMessage(synced, {}, subject, FIELDS)
    expect(res).toEqual({ ok: false, reason: 'unmapped', positions: [1, 2] })
  })

  it('never infers meaning from the slot INDEX', () => {
    // Only position 1 is mapped; position 2 must not silently take the next
    // available value.
    const res = resolveTemplateMessage(synced, { '1': 'leadFirstName' }, subject, FIELDS)
    expect(res).toEqual({ ok: false, reason: 'unmapped', positions: [2] })
  })

  it('resolves a synced template once every slot is mapped', () => {
    const res = resolveTemplateMessage(synced, { '1': 'leadFirstName', '2': 'meetingWhen' }, subject, FIELDS)
    expect(res).toMatchObject({ ok: true, params: ['אלמיהו', 'יום רביעי בשעה 10:30'] })
    expect((res as { text: string }).text).toBe('שלום אלמיהו, הפגישה שלך ב־יום רביעי בשעה 10:30')
  })

  it('refuses a binding to a field the action cannot resolve', () => {
    // An unknown source is as unusable as an absent one.
    const res = resolveTemplateMessage(synced, { '1': 'leadFirstName', '2': 'creditCard' }, subject, FIELDS)
    expect(res).toEqual({ ok: false, reason: 'unmapped', positions: [2] })
  })
})

describe('parameters are legal for Meta, whatever the CRM stored', () => {
  it('collapses newlines — meetingDetails is multi-line and would be rejected raw', () => {
    const details = 'פגישת ייעוץ\nיום רביעי, בשעה 10:30\nמקום: רוטשילד 1\nקישור לפגישה: https://meet.google.com/x'
    const clean = sanitizeParam(details)
    expect(clean).not.toMatch(/[\n\r\t]/)
    expect(clean).toContain('פגישת ייעוץ')
    expect(clean).toContain('רוטשילד 1')
  })

  it('collapses runs of spaces and trims', () => {
    expect(sanitizeParam('  a     b  ')).toBe('a b')
  })

  it('never yields an empty parameter — Meta refuses those outright', () => {
    const t = { bodyText: 'שלום {{1}}', variables: [] }
    const res = resolveTemplateMessage(t, { '1': 'leadFirstName' }, { leadFirstName: '   ' }, ['leadFirstName'])
    expect(res).toMatchObject({ ok: true })
    expect((res as { params: string[] }).params[0].length).toBeGreaterThan(0)
  })

  it('sends the SAME value it shows in the conversation', () => {
    // The persisted text is built from the params, so the thread cannot disagree
    // with what the lead received.
    const t = { bodyText: 'שלום {{1}}', variables: [] }
    const res = resolveTemplateMessage(t, { '1': 'meetingDetails' }, { meetingDetails: 'א\nב' }, ['meetingDetails'])
    const { params, text } = res as { params: string[]; text: string }
    expect(text).toContain(params[0])
  })
})
