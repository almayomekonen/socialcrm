// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EXPIRED, NOW, SELECTED_LEAD, SELECTED_LEADLESS, OPERATOR_TAKE, inboxEnv, resetInboxEnv } from './inboxEnv'
import { inboxPage, inboxShell, withInboxEnv } from './inboxHarness'
import { inboxSpies as S, resetInboxSpies } from './inboxMocks'

/**
 * HEBREW BASELINE — `/inbox` INTERACTIONS: what the rep sees after acting
 * (menus, confirmations, toasts, inline errors, the image viewer, the failure
 * tooltip, the awareness toasts) and the exact arguments each action receives.
 * Recorded BEFORE the Phase D inbox package, rendered with NO i18n provider.
 * Server HTML: inboxHebrewBaseline.test.tsx.
 *
 * Normalized before comparing, and only these: React `useId` values.
 */

vi.mock('next/navigation', async () => (await import('./inboxMocks')).navigationModule())
vi.mock('next/dynamic', async () => ({ default: (await import('./leadTabsHarness')).nextDynamicMock }))
vi.mock('next/cache', async () => (await import('./inboxMocks')).cacheModule())
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => null }), headers: () => ({ get: () => null }) }))
vi.mock('@/db/auth', async () => ({ getUser: async () => (await import('./inboxEnv')).inboxEnv.user }))
vi.mock('@/lib/requireUser', async () => ({ requireAgencyUser: async () => (await import('./inboxEnv')).inboxEnv.user }))
vi.mock('@/db/uiLocale', async () => {
  const { inboxSpies } = await import('./inboxMocks')
  return { getUiLocalePrefs: async () => ({ userLocale: inboxSpies.prefs.userLocale, agencyLocale: null }) }
})
vi.mock('@/lib/device', () => ({ isMobileRequest: async () => false, isMobileWorkspaceRequest: async () => false }))
vi.mock('@/lib/flags/inboxFlags', () => ({ isInboxDeltaSyncEnabled: () => false, getInboxRefreshIntervalMs: () => null }))
vi.mock('@/lib/facebook/permissions', async () => {
  const { inboxEnv: env } = await import('./inboxEnv')
  return { isFacebookMessengerEnabledForAgency: () => env.messengerEnabled }
})
vi.mock('@/modules/messenger/queries', async () => {
  const { inboxEnv: env } = await import('./inboxEnv')
  return { countUnreadMessengerConversations: async () => env.messengerUnread }
})
vi.mock('@/modules/inbox/queries', async () => (await import('./inboxMocks')).queriesModule())
vi.mock('@/modules/inbox/actions', async () => (await import('./inboxMocks')).inboxActionsModule())
vi.mock('@/db/inboxMessages', async () => {
  const { inboxEnv: env } = await import('./inboxEnv')
  return { listConversationMessages: async () => structuredClone(env.messages) }
})
vi.mock('@/lib/inbox/whatsappComposerContext', async () => {
  const { inboxEnv: env } = await import('./inboxEnv')
  return { loadWhatsappComposerContext: async () => env.composer }
})
vi.mock('@/db/conversationAiState', async () => (await import('./inboxMocks')).aiStateModule())
vi.mock('@/db/conversationIntelligence', async () => (await import('./inboxMocks')).conversationIntelligenceModule())
vi.mock('@/db/autoResponseSettings', async () => (await import('./inboxMocks')).autoResponseSettingsModule())
vi.mock('@/db/questionnaireSessions', async () => (await import('./inboxMocks')).questionnaireSessionsModule())
vi.mock('@/lib/inbox/autoresponse/reliability/entitlement', async () => (await import('./inboxMocks')).replyEntitlementModule())
vi.mock('@/actions/inbox/agentOwnership', async () => (await import('./inboxMocks')).ownershipActionsModule())
vi.mock('@/actions/whatsapp/promoteConversationToLead', async () => (await import('./inboxMocks')).promoteActionsModule())
vi.mock('@/actions/whatsapp/markConversationPersonal', async () => ({ markConversationPersonal: (await import('./inboxMocks')).inboxSpies.markPersonal }))
vi.mock('@/actions/whatsapp/sendWhatsappReply', async () => ({ sendWhatsappReply: (await import('./inboxMocks')).inboxSpies.sendReply }))
vi.mock('@/actions/ai/whatsappReplyDraft', async () => ({ generateWhatsappReplyDraft: (await import('./inboxMocks')).inboxSpies.generateDraft }))
vi.mock('@/actions/whatsapp/templates/sendTemplateToLead', async () => ({ sendTemplateToLead: (await import('./inboxMocks')).inboxSpies.sendTemplate }))
vi.mock('@/actions/analytics/recordOperatorTakeEvent', async () => {
  const { inboxSpies } = await import('./inboxMocks')
  return { recordOperatorTakeEvent: async (...a: unknown[]) => inboxSpies.operatorEvents.push(a) }
})
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/modules/leads/contactEvents', () => ({ contactClicked: () => {}, contactSucceeded: () => {} }))
vi.mock('@/actions/ai/leadIntelligence', async () => (await import('./inboxMocks')).leadIntelligenceModule())
vi.mock('@/actions/ai/leadIntelligenceRefresh', () => ({ refreshLeadIntelligence: async () => ({ ok: true }) }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess: async () => ({ hasAccess: true }) }))
vi.mock('@/lib/toast', async () => (await import('./inboxMocks')).toastModule())


function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const html = (el: Element | null | undefined) => {
  if (!el) throw new Error('element not found')
  return normalizeIds(el.outerHTML)
}
const mount = async (overrides: Partial<typeof inboxEnv> = {}, ent?: typeof EXPIRED) =>
  render(await inboxShell(null, await withInboxEnv(overrides, () => inboxPage()), ent))
const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLElement

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetInboxEnv()
  resetInboxSpies()
})

describe('Hebrew baseline — conversation actions menu + delete', () => {
  test('row menu, confirmation dialog, success and failure', async () => {
    await mount({ selected: SELECTED_LEAD })
    const out: Record<string, unknown> = {}
    const trigger = screen.getAllByLabelText('פעולות שיחה')[0]
    await act(async () => fireEvent.click(trigger))
    out.menu = html(document.querySelector('[role="menu"]'))
    fireEvent.keyDown(document, { key: 'Escape' })
    out.menuAfterEscape = document.querySelector('[role="menu"]') === null
    await act(async () => fireEvent.click(trigger))
    await act(async () => fireEvent.click(screen.getByRole('menuitem')))
    out.dialog = html(document.querySelector('[role="dialog"]'))
    S.deleteConversation.mockResolvedValueOnce({ ok: false, deleted: false })
    await act(async () => fireEvent.click(screen.getAllByText('מחק שיחה').at(-1)!))
    S.deleteConversation.mockRejectedValueOnce(new Error('x'))
    await act(async () => fireEvent.click(screen.getAllByText('מחק שיחה').at(-1)!))
    await act(async () => fireEvent.click(screen.getAllByText('מחק שיחה').at(-1)!))
    out.calls = S.deleteConversation.mock.calls
    out.toasts = S.toasts
    out.replaces = S.replaces
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — reply composer', () => {
  test('send success, send failures (category, generic, thrown), AI draft success + failure, copy, emoji panel, near-limit counter', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
    const { container } = await mount({ selected: SELECTED_LEAD })
    const out: Record<string, unknown> = {}
    const box = container.querySelector('#wa-reply-draft') as HTMLTextAreaElement
    const type = (v: string) => fireEvent.change(box, { target: { value: v } })
    const send = () => act(async () => fireEvent.click(byLabel('שלח הודעה')))
    type('שלום רב')
    await send()
    S.sendReply.mockResolvedValueOnce({ ok: false, reason: 'send-failed', category: 'recipient' })
    type('שני')
    await send()
    S.sendReply.mockResolvedValueOnce({ ok: false, reason: 'empty' })
    await send()
    S.sendReply.mockRejectedValueOnce(new Error('x'))
    await send()
    out.valueAfterFailures = box.value
    await act(async () => fireEvent.click(screen.getByTitle('נסח טיוטה עם AI')))
    out.drafted = box.value
    S.generateDraft.mockResolvedValueOnce({ ok: false, reason: 'x' })
    await act(async () => fireEvent.click(screen.getByTitle('נסח טיוטה עם AI')))
    out.draftError = html(box.closest('div')!.parentElement)
    await act(async () => fireEvent.click(byLabel('העתק טיוטה')))
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } })
    document.execCommand = () => false
    await act(async () => fireEvent.click(byLabel('העתק טיוטה')))
    await act(async () => fireEvent.click(byLabel('הוספת אימוג׳י')))
    out.emojiPanel = html(document.querySelector('[role="dialog"][aria-label]'))
    type('א'.repeat(3700))
    out.counter = html(box.closest('div')!.parentElement!.querySelector('.tabular-nums'))
    out.sendCalls = S.sendReply.mock.calls
    out.toasts = S.toasts
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — ownership and leadless actions', () => {
  test('take over / return: pending label and every refusal reason', async () => {
    const out: Record<string, unknown> = {}
    await mount({ selected: SELECTED_LEAD, ownership: 'agent' })
    for (const reason of ['opted_out', 'closed', 'forbidden', 'failed', 'invalid-input', 'unmapped']) {
      S.takeOver.mockResolvedValueOnce({ ok: false, reason })
      await act(async () => fireEvent.click(screen.getByText('אני עונה מכאן')))
      out[reason] = screen.getByRole('alert').textContent
    }
    cleanup()
    await mount({ selected: SELECTED_LEAD, ownership: 'human' })
    S.returnToAgent.mockResolvedValueOnce({ ok: false })
    await act(async () => fireEvent.click(screen.getByText('החזרת המענה לסוכן')))
    out.returnFailed = screen.getByRole('alert').textContent
    out.takeOverCalls = S.takeOver.mock.calls
    out.returnCalls = S.returnToAgent.mock.calls
    expect(out).toMatchSnapshot()
  })

  test('leadless: create (quota / failure), link (not found / no match / failure / several), personal failure', async () => {
    const { container } = await mount({ selected: SELECTED_LEADLESS })
    const out: Record<string, unknown> = {}
    const alert = () => screen.getByRole('alert').textContent
    const click = (text: string) => act(async () => fireEvent.click(screen.getByText(text)))
    S.promote.mockResolvedValueOnce({ ok: false, reason: 'quota_exceeded' })
    await click('+ צור ליד')
    out.quota = alert()
    S.promote.mockResolvedValueOnce({ ok: false, reason: 'x' })
    await click('+ צור ליד')
    out.createFailed = alert()
    S.listMatches.mockResolvedValueOnce({ ok: false })
    await click('קשר לליד קיים')
    out.notFound = alert()
    await click('קשר לליד קיים')
    out.noMatch = alert()
    S.listMatches.mockResolvedValueOnce({ ok: true, matches: [{ id: 41, name: 'יוסי לוי' }] })
    S.link.mockResolvedValueOnce({ ok: false })
    await click('קשר לליד קיים')
    out.linkFailed = alert()
    S.listMatches.mockResolvedValueOnce({ ok: true, matches: [{ id: 41, name: 'יוסי לוי' }, { id: 42, name: 'יוסי לוי (2)' }] })
    await click('קשר לליד קיים')
    out.several = html(container.querySelector('section .flex.flex-wrap.items-center.gap-1\\.5'))
    S.markPersonal.mockResolvedValueOnce({ ok: false })
    await click('סמן כאישי')
    out.personalFailed = alert()
    out.calls = {
      promote: S.promote.mock.calls,
      list: S.listMatches.mock.calls,
      link: S.link.mock.calls,
      personal: S.markPersonal.mock.calls,
    }
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — media, failure tooltip, operator take, notifier, awareness', () => {
  test('image viewer, voice note controls, failure tooltip panel, operator take dismiss', async () => {
    const out: Record<string, unknown> = {}
    await mount({ selected: SELECTED_LEAD, operatorTake: OPERATOR_TAKE })
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: /^הצג את התמונה/ })[0]))
    out.viewer = html(document.querySelector('[role="dialog"]'))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    out.voice = html(screen.getByLabelText('נגן הקלטה').parentElement)
    const tipTrigger = screen.getAllByText(/^לא ניתן לשלוח את ההודעה\./)[0].parentElement as HTMLElement
    await act(async () => fireEvent.focus(tipTrigger))
    await waitFor(() => expect(document.querySelector('[role="tooltip"]')).not.toBeNull())
    out.tooltip = html(document.querySelector('[role="tooltip"]'))
    await act(async () => fireEvent.click(screen.getByLabelText('הסתר')))
    out.takeGone = screen.queryByText(OPERATOR_TAKE.data.actionMessage) === null
    out.events = S.operatorEvents.map(([name]) => name)
    expect(out).toMatchSnapshot()
  })

  test('new-message toast in the open thread; awareness toasts off-inbox (one / several)', async () => {
    const out: Record<string, unknown> = {}
    const { default: Notifier } = await import('@/components/summary/WhatsappNewMessageNotifier')
    const r = render(<Notifier latestInboundId={1} />)
    r.rerender(<Notifier latestInboundId={2} />)
    const { AwarenessProvider, useAwareness } = await import('@/modules/inbox/awareness/AwarenessContext')
    let merge: ReturnType<typeof useAwareness>['mergeAwareness'] = () => {}
    function Probe() {
      merge = useAwareness().mergeAwareness
      return null
    }
    render(
      <AwarenessProvider enabled={false} initialUnread={0}>
        <Probe />
      </AwarenessProvider>,
    )
    const later = new Date(NOW + 60_000).toISOString()
    act(() => merge({ whatsappUnread: 1 }, [{ type: 'whatsapp_message', conversationId: 9, contactName: 'יוסי לוי', at: later }]))
    act(() =>
      merge({ whatsappUnread: 3 }, [
        { type: 'whatsapp_message', conversationId: 10, contactName: 'רונית', at: later },
        { type: 'whatsapp_message', conversationId: 11, contactName: 'משה', at: later },
      ]),
    )
    out.toasts = S.toasts.map((t) => t.slice(0, 3))
    expect(out).toMatchSnapshot()
  })
})
