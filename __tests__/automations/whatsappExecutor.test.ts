import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalWhatsappAccountError } from '@/lib/inbox/onWhatsappSendFailure'

/**
 * The `whatsapp.send` EXECUTOR.
 *
 * Mocked at the two database seams so this file actually runs: the repo's
 * DB-backed suites cannot execute in this environment (Prisma-vs-knex harness),
 * and an unrunnable test proves nothing. Everything below the mocks is the real
 * executor, the real parameter resolver and the real ordering.
 *
 * What is being defended:
 *   · a configuration fault is reported as a PREFLIGHT problem, never thrown —
 *     the worker must be able to decide the job's fate without the lead's
 *     once-ever send allowance being burned on the business's mistake;
 *   · observation mode does the whole job except the effect;
 *   · a live send persists with SYSTEM attribution, only after a confirmed wamid;
 *   · a transport failure THROWS, because that is what releases the claim and
 *     lets the job retry.
 */

const recordAccountRestriction = vi.hoisted(() => vi.fn())

vi.mock('@/db/whatsappTemplates', () => ({ loadTemplateForSend: vi.fn() }))
vi.mock('@/lib/inbox/whatsappOutboundTarget', () => ({ resolveWhatsappOutboundTarget: vi.fn() }))
vi.mock('@/lib/inbox/recordAccountRestriction', () => ({ recordAccountRestriction }))

const { whatsappExecutor } = await import('@/lib/automations/executors/whatsapp')

type Ctx = Parameters<typeof whatsappExecutor.preflight>[0]

const APPROVED = {
  id: 5,
  status: 'approved' as const,
  name: 'appointment_reminder_he',
  language: 'he',
  bodyText: 'שלום {{1}}, נזכיר לך על {{2}}',
  variables: [],
  bindings: [],
}

const TARGET = {
  leadId: 42,
  leadName: 'אלמיהו מקונן',
  businessPhoneNumberId: '111222333',
  accessToken: 'tok_live',
  customerWaId: '972501234567',
  customerName: 'אלמיהו',
}

const BINDINGS = { '1': 'leadFirstName', '2': 'meetingTitle' }

const ctx = (over: Partial<Ctx> = {}): Ctx =>
  ({
    agencyId: 7,
    automationId: 3,
    leadId: 42,
    mode: 'live',
    subject: { leadFirstName: 'אלמיהו', meetingTitle: 'פגישת ייעוץ', businessName: 'SocialCRM' },
    recipients: { phone: '972501234567' },
    parameters: { templateId: 5, templateBindings: BINDINGS },
    ...over,
  }) as Ctx

/** The transport's real envelope, so a failure can be simulated as one. */
type SendResult = { ok: true; wamid: string } | { ok: false; error: string; code?: string }
const send = vi.fn(async (): Promise<SendResult> => ({ ok: true, wamid: 'wamid.ABC' }))
const persist = vi.fn(async (_args: Record<string, unknown>) => ({ conversationId: 1, messageId: 2 }))
const loadTemplate = vi.fn(async () => APPROVED as never)
const resolveTarget = vi.fn(async () => ({ ok: true as const, target: TARGET }) as never)

const deps = (over: Record<string, unknown> = {}) =>
  ({ loadTemplate, resolveTarget, send, persist, ...over }) as never

beforeEach(() => {
  send.mockClear()
  persist.mockClear()
  loadTemplate.mockClear()
  resolveTarget.mockClear()
  recordAccountRestriction.mockReset().mockResolvedValue(undefined)
  loadTemplate.mockImplementation(async () => APPROVED as never)
  resolveTarget.mockImplementation(async () => ({ ok: true as const, target: TARGET }) as never)
})

describe('preflight names every configuration fault, and throws none of them', () => {
  it('accepts a fully configured action', async () => {
    const pre = await whatsappExecutor.preflight(ctx(), deps())
    expect(pre.problem).toBeNull()
    expect(pre.ready?.template.name).toBe('appointment_reminder_he')
    expect(pre.ready?.params).toEqual(['אלמיהו', 'פגישת ייעוץ'])
  })

  it('refuses when no template was chosen', async () => {
    const pre = await whatsappExecutor.preflight(ctx({ parameters: {} }), deps())
    expect(pre.problem?.reason).toBe('template_not_chosen')
    expect(pre.ready).toBeNull()
  })

  it('refuses when the template is gone or belongs to another agency', async () => {
    loadTemplate.mockImplementation(async () => null as never)
    const pre = await whatsappExecutor.preflight(ctx(), deps())
    expect(pre.problem?.reason).toBe('template_missing')
  })

  it('re-checks APPROVAL at send time, not at configuration time', async () => {
    // Meta can reject, pause or disable a template long after the automation was
    // built. Trusting the status captured when it was configured is the one
    // wrong thing to do.
    for (const status of ['pending', 'rejected', 'paused', 'disabled']) {
      loadTemplate.mockImplementation(async () => ({ ...APPROVED, status } as never))
      const pre = await whatsappExecutor.preflight(ctx(), deps())
      expect(pre.problem?.reason).toBe(`template_not_approved:${status}`)
    }
  })

  it('refuses when the lead has no WhatsApp destination', async () => {
    resolveTarget.mockImplementation(async () => ({ ok: false as const, reason: 'no-connection' }) as never)
    const pre = await whatsappExecutor.preflight(ctx(), deps())
    expect(pre.problem?.reason).toBe('no_target:no-connection')
  })

  it('refuses an unmapped slot rather than sending a mismatched parameter count', async () => {
    // This is Meta's #132000 made unreachable.
    const pre = await whatsappExecutor.preflight(ctx({ parameters: { templateId: 5 } }), deps())
    expect(pre.problem?.reason).toBe('template_unmapped:1,2')
    expect(send).not.toHaveBeenCalled()
  })

  it('every fault is definitive — the worker is told not to retry it', async () => {
    const pre = await whatsappExecutor.preflight(ctx({ parameters: {} }), deps())
    expect(pre.problem?.deadReason).toBeTruthy()
    expect(pre.problem?.logClass).toBe('whatsapp_config')
  })

  it('reaches no transport while deciding', async () => {
    await whatsappExecutor.preflight(ctx(), deps())
    expect(send).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })
})

describe('observation mode does everything except the effect', () => {
  it('resolves the real message but sends nothing', async () => {
    const c = ctx({ mode: 'log' })
    const pre = await whatsappExecutor.preflight(c, deps())
    const out = await whatsappExecutor.execute(c, pre.ready!, deps())

    expect(out.kind).toBe('would_send')
    // The summary is the REAL resolved message, which is what makes a log-mode
    // pass evidence rather than a rehearsal.
    expect(out.summary).toBe('שלום אלמיהו, נזכיר לך על פגישת ייעוץ')
    expect(send).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })

  it('records no provider message id, because no message exists', async () => {
    const c = ctx({ mode: 'log' })
    const pre = await whatsappExecutor.preflight(c, deps())
    const out = await whatsappExecutor.execute(c, pre.ready!, deps())
    expect(out.providerMessageId ?? null).toBeNull()
    expect(out.deliveryState ?? null).toBeNull()
  })
})

describe('a live send reuses the existing infrastructure exactly', () => {
  it('sends the approved template through the template service', async () => {
    const c = ctx()
    const pre = await whatsappExecutor.preflight(c, deps())
    const out = await whatsappExecutor.execute(c, pre.ready!, deps())

    expect(send).toHaveBeenCalledWith({
      phoneNumberId: '111222333',
      accessToken: 'tok_live',
      to: '972501234567',
      name: 'appointment_reminder_he',
      language: 'he',
      params: ['אלמיהו', 'פגישת ייעוץ'],
    })
    expect(out).toMatchObject({ kind: 'sent', deliveryState: 'sent', providerMessageId: 'wamid.ABC' })
  })

  it('persists into the lead conversation with SYSTEM attribution', async () => {
    const c = ctx()
    const pre = await whatsappExecutor.preflight(c, deps())
    await whatsappExecutor.execute(c, pre.ready!, deps())

    const args = persist.mock.calls[0][0] as Record<string, unknown>
    // null, not the lead's owner: the instant-response engine distinguishes "any
    // outbound" from "a human replied" by exactly this field, and claiming a
    // person replied would silence a reply that should happen.
    expect(args.sentByUserId).toBeNull()
    expect(args).toMatchObject({
      agencyId: 7,
      leadId: 42,
      wamid: 'wamid.ABC',
      customerWaId: '972501234567',
      text: 'שלום אלמיהו, נזכיר לך על פגישת ייעוץ',
    })
  })

  it('persists only AFTER a confirmed wamid — never before', async () => {
    send.mockImplementation(async () => ({ ok: false, error: 'rate limited', code: '131056' }))
    const c = ctx()
    const pre = await whatsappExecutor.preflight(c, deps())
    await expect(whatsappExecutor.execute(c, pre.ready!, deps())).rejects.toThrow(/131056/)
    // A failed Cloud API call must not leave a fake message in the conversation.
    expect(persist).not.toHaveBeenCalled()
    send.mockImplementation(async () => ({ ok: true, wamid: 'wamid.ABC' }))
  })

  it('THROWS on transport failure, so the claim releases and the job retries', async () => {
    send.mockImplementation(async () => ({ ok: false, error: 'network-error' }))
    const c = ctx()
    const pre = await whatsappExecutor.preflight(c, deps())
    await expect(whatsappExecutor.execute(c, pre.ready!, deps())).rejects.toThrow(/network-error/)
    expect(recordAccountRestriction).not.toHaveBeenCalled()
    send.mockImplementation(async () => ({ ok: true, wamid: 'wamid.ABC' }))
  })

  it('131031 records a restriction and throws a TERMINAL error — not a retryable transport error', async () => {
    send.mockImplementation(async () => ({ ok: false, error: 'restricted', code: '131031' }))
    const c = ctx()
    const pre = await whatsappExecutor.preflight(c, deps())
    await expect(whatsappExecutor.execute(c, pre.ready!, deps())).rejects.toBeInstanceOf(TerminalWhatsappAccountError)
    expect(recordAccountRestriction).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyId: 7,
        leadId: 42,
        businessPhoneNumberId: '111222333',
        customerWaId: '972501234567',
        sentByUserId: null,
      }),
    )
    expect(persist).not.toHaveBeenCalled()
    send.mockImplementation(async () => ({ ok: true, wamid: 'wamid.ABC' }))
  })
})

describe('the multi-line meeting details survive Meta’s parameter rules', () => {
  it('collapses them instead of being rejected', async () => {
    const c = ctx({
      parameters: { templateId: 5, templateBindings: { '1': 'leadFirstName', '2': 'meetingDetails' } },
      subject: { leadFirstName: 'אלמיהו', meetingDetails: 'פגישת ייעוץ\nיום רביעי 10:30\nמקום: רוטשילד 1' },
    })
    const pre = await whatsappExecutor.preflight(c, deps())
    expect(pre.problem).toBeNull()
    const [, second] = pre.ready!.params
    expect(second).not.toMatch(/[\n\r\t]/)
    expect(second).toContain('רוטשילד 1')
  })
})

describe('the Builder preview is the real resolver', () => {
  it('returns a MESSAGE-shaped preview', async () => {
    const res = await whatsappExecutor.preview!(
      { templateId: 5, templateBindings: BINDINGS },
      { agencyId: 7, toName: 'דנה' },
      deps(),
    )
    expect(res).toMatchObject({ ok: true, shape: 'message' })
    expect((res as { text: string }).text).toContain('דנה')
  })

  it('says so when the chosen template cannot currently be sent', async () => {
    loadTemplate.mockImplementation(async () => ({ ...APPROVED, status: 'paused' } as never))
    const res = await whatsappExecutor.preview!(
      { templateId: 5, templateBindings: BINDINGS },
      { agencyId: 7, toName: 'דנה' },
      deps(),
    )
    // Both facts at once: what it says, AND that it is not sendable.
    expect(res).toMatchObject({ ok: true, shape: 'message', notApproved: true })
  })

  it('previews an unmapped template as a failure, not as plausible text', async () => {
    const res = await whatsappExecutor.preview!({ templateId: 5 }, { agencyId: 7, toName: 'דנה' }, deps())
    expect(res).toMatchObject({ ok: false })
  })
})

describe('no test send is offered', () => {
  it('has no test method, matching the catalog', () => {
    // A WhatsApp test costs money per message and spends the template's quality
    // rating; the preview runs the same resolver, so nothing is lost.
    expect(whatsappExecutor.test).toBeUndefined()
  })
})

describe('P1 — automations stay lead-based', () => {
  it('default targeting is resolveWhatsappOutboundTarget, not a conversation id', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'lib/automations/executors/whatsapp.ts'), 'utf8')
    expect(src).toContain('resolveWhatsappOutboundTarget')
    expect(src).not.toContain('resolveWhatsappOutboundTargetForConversation')
    expect(src).not.toContain('conversationId')
    const pre = await whatsappExecutor.preflight(ctx(), deps())
    expect(resolveTarget).toHaveBeenCalledWith(7, 42)
    expect(pre.problem).toBeNull()
  })
})
