import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type { ComposerContextDeps } from '@/lib/inbox/whatsappComposerContext'

const { loadWhatsappComposerContext } = await import('@/lib/inbox/whatsappComposerContext')
const { assertWhatsappFreeTextAllowed } = await import('@/lib/inbox/whatsappFreeTextGate')

const HOUR = 60 * 60 * 1000
const now = Date.now()

function deps(overrides: Partial<ComposerContextDeps> = {}) {
  return {
    getConversation: vi.fn(async (agencyId: number, conversationId: number) => {
      if (agencyId !== 23 || conversationId !== 44) return null
      return { conversationId: 44, leadId: 9, businessPhoneNumberId: 'PHONE_A' }
    }),
    getLatestConversationForLead: vi.fn(async (agencyId: number, leadId: number) => {
      if (agencyId !== 23 || leadId !== 9) return null
      return { conversationId: 44, leadId: 9, businessPhoneNumberId: 'PHONE_A' }
    }),
    getLatestInboundAt: vi.fn(async () => new Date(now - 2 * HOUR).toISOString()),
    getConnectionForPhone: vi.fn(async (agencyId: number, phone: string) => {
      if (agencyId !== 23 || phone !== 'PHONE_A') return null
      return { phone_number_id: 'PHONE_A', access_token: 't', waba_id: 'W' }
    }),
    resolveHealth: vi.fn(async () => ({ primary: 'operational' as const })),
    isTemplatesEnabled: vi.fn(() => true),
    listApprovedTemplates: vi.fn(async (agencyId: number) =>
      agencyId === 23
        ? [
            {
              id: 1,
              displayTitle: 'שלום',
              status: 'approved' as const,
              bodyText: 'היי',
              variables: [],
              failureText: null,
              archived: false,
              createdAt: '2026-08-01T00:00:00.000Z',
            },
          ]
        : [],
    ),
    ...overrides,
  }
}

describe('loadWhatsappComposerContext — isolation', () => {
  it('O — another agency cannot load this conversation', async () => {
    const d = deps()
    const ctx = await loadWhatsappComposerContext(99, 44, { deps: d })
    expect(d.getConversation).toHaveBeenCalledWith(99, 44)
    expect(ctx.health).toBe('disconnected')
    expect(ctx.templates).toEqual([])
    expect(d.getConnectionForPhone).not.toHaveBeenCalled()
  })

  it('P — health and templates resolve against the conversation phone, not another phone', async () => {
    const d = deps()
    const ctx = await loadWhatsappComposerContext(23, 44, { deps: d })
    expect(d.getConnectionForPhone).toHaveBeenCalledWith(23, 'PHONE_A')
    expect(d.getConnectionForPhone).not.toHaveBeenCalledWith(23, 'PHONE_B')
    expect(d.resolveHealth).toHaveBeenCalledWith(
      { phone_number_id: 'PHONE_A', access_token: 't', waba_id: 'W' },
      23,
    )
    expect(ctx.businessPhoneNumberId).toBe('PHONE_A')
    expect(ctx.templates).toHaveLength(1)
  })

  it('K — feature flag OFF does not list templates', async () => {
    const d = deps({ isTemplatesEnabled: () => false })
    const ctx = await loadWhatsappComposerContext(23, 44, { deps: d })
    expect(ctx.templatesEnabled).toBe(false)
    expect(ctx.templates).toEqual([])
    expect(d.listApprovedTemplates).not.toHaveBeenCalled()
  })
})

describe('assertWhatsappFreeTextAllowed', () => {
  it('A — inbound 2h ago + operational → allowed', async () => {
    const res = await assertWhatsappFreeTextAllowed({ agencyId: 23, leadId: 9, conversationId: 44 }, deps())
    expect(res).toEqual({ ok: true })
  })

  it('E — outbound being newer is irrelevant; inbound 30h ago → CLOSED', async () => {
    const d = deps({
      getLatestInboundAt: async () => new Date(now - 30 * HOUR).toISOString(),
    })
    const res = await assertWhatsappFreeTextAllowed({ agencyId: 23, leadId: 9, conversationId: 44 }, d)
    expect(res).toEqual({ ok: false, reason: 'window-closed' })
  })

  it('F — no inbound → UNKNOWN / blocked', async () => {
    const d = deps({ getLatestInboundAt: async () => null })
    const res = await assertWhatsappFreeTextAllowed({ agencyId: 23, leadId: 9, conversationId: 44 }, d)
    expect(res).toEqual({ ok: false, reason: 'window-unknown' })
  })

  it('G — restricted + OPEN inbound → blocked', async () => {
    const d = deps({ resolveHealth: async () => ({ primary: 'restricted' }) })
    const res = await assertWhatsappFreeTextAllowed({ agencyId: 23, leadId: 9, conversationId: 44 }, d)
    expect(res).toEqual({ ok: false, reason: 'health-blocked' })
  })

  it('Q — leadless conversation stays blocked', async () => {
    const d = deps({
      getConversation: async () => ({ conversationId: 44, leadId: null, businessPhoneNumberId: 'PHONE_A' }),
    })
    const res = await assertWhatsappFreeTextAllowed({ agencyId: 23, leadId: 9, conversationId: 44 }, d)
    expect(res).toEqual({ ok: false, reason: 'window-unknown' })
  })
})

/**
 * SERVER-SIDE gate, not the composer decision.
 *
 * The composer was taught that `throttled` (#80008) is sendable, but this gate —
 * the one `actions/whatsapp/sendWhatsappReply.ts` actually calls — still compared
 * against `'operational'` alone. The result was a composer that invited a send
 * the server then refused. These tests pin the server rule itself.
 */
describe('assertWhatsappFreeTextAllowed · health rule', () => {
  const run = (primary: string) =>
    assertWhatsappFreeTextAllowed(
      { agencyId: 23, leadId: 9, conversationId: 44 },
      deps({ resolveHealth: vi.fn(async () => ({ primary: primary as never })) }),
    )

  it('throttled is ALLOWED — a rate-limited probe is not a broken connection', async () => {
    await expect(run('throttled')).resolves.toEqual({ ok: true })
  })

  it('operational is allowed, unchanged', async () => {
    await expect(run('operational')).resolves.toEqual({ ok: true })
  })

  it('token is still blocked — a dead credential must never reach Graph', async () => {
    await expect(run('token')).resolves.toEqual({ ok: false, reason: 'health-blocked' })
  })

  it('restricted is still blocked', async () => {
    await expect(run('restricted')).resolves.toEqual({ ok: false, reason: 'health-blocked' })
  })

  it('unknown is still blocked — a failed check is not a throttled one', async () => {
    await expect(run('unknown')).resolves.toEqual({ ok: false, reason: 'health-blocked' })
  })

  it('webhook, registration_pending and disconnected all still block', async () => {
    for (const h of ['webhook', 'registration_pending', 'disconnected']) {
      await expect(run(h)).resolves.toEqual({ ok: false, reason: 'health-blocked' })
    }
  })

  it('throttled does NOT bypass the service window', async () => {
    // Health is only the first gate; the 24-hour window still applies.
    const d = deps({
      resolveHealth: vi.fn(async () => ({ primary: 'throttled' as never })),
      getLatestInboundAt: async () => new Date(now - 30 * HOUR).toISOString(),
    })
    await expect(
      assertWhatsappFreeTextAllowed({ agencyId: 23, leadId: 9, conversationId: 44 }, d),
    ).resolves.toEqual({ ok: false, reason: 'window-closed' })
  })
})
