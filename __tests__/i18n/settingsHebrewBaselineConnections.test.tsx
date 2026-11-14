// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NOW, PENDING_PAGES, PENDING_PHONES, resetSetEnv, setEnv } from './settingsEnv'
import { setShell, settingsPage } from './settingsHarness'

/**
 * HEBREW BASELINE — interactions on /settings/integrations (Phase E4):
 * Facebook / WhatsApp connect, disconnect and every failure notice; the
 * ready-made messages workspace (create dialog, validation, every toast,
 * archive / discard / retry / edit); Messenger entry points and saved replies
 * (every failure reason, delete confirmation); Google Calendar / Drive / AI
 * connections (status, how-to, disconnect). Recorded BEFORE Phase E4 on
 * unmodified product code.
 */

vi.mock('next/navigation', async () => (await import('./settingsMocks')).navigationModule())
vi.mock('next/headers', async () => (await import('./settingsMocks')).headersModule())
vi.mock('@/lib/toast', async () => (await import('./settingsMocks')).toastModule())
vi.mock('@/db/auth', async () => (await import('./settingsMocks')).authModule())
vi.mock('@/lib/requireUser', async () => (await import('./settingsMocks')).requireUserModule())
vi.mock('@/db/uiLocale', () => ({ getUiLocalePrefs: async () => ({ userLocale: null, agencyLocale: null }) }))
vi.mock('@/lib/device', async () => (await import('./settingsMocks')).deviceModule())
vi.mock('@/lib/access/productAccess', async () => (await import('./settingsMocks')).productAccessModule())
vi.mock('@/config/db', async () => (await import('./settingsMocks')).configDbModule())
vi.mock('@/lib/facebook/pendingPages', async () => (await import('./settingsMocks')).pendingPagesModule())
vi.mock('@/lib/facebook/health', async () => (await import('./settingsMocks')).facebookHealthModule())
vi.mock('@/lib/facebook/pageToken', async () => (await import('./settingsMocks')).pageTokenModule())
vi.mock('@/db/facebook', async () => (await import('./settingsMocks')).facebookDbModule())
vi.mock('@/lib/facebook/comments/capability', async () => (await import('./settingsMocks')).commentsCapabilityModule())
vi.mock('@/lib/whatsapp/registration', async () => (await import('./settingsMocks')).registrationModule())
vi.mock('@/lib/whatsapp/operationalStatus', async () => (await import('./settingsMocks')).operationalStatusModule())
vi.mock('@/db/whatsapp', async () => (await import('./settingsMocks')).whatsappDbModule())
vi.mock('@/lib/whatsapp/templates/flag', async () => (await import('./settingsMocks')).templatesFlagModule())
vi.mock('@/db/whatsappTemplates', async () => (await import('./settingsMocks')).templatesDbModule())
vi.mock('@/components/settings/messenger/messengerSectionData', async () => (await import('./settingsMocks')).messengerSectionModule())
vi.mock('@/lib/automations/flags', async () => (await import('./settingsMocks')).automationsFlagsModule())
vi.mock('@/db/googleCalendarConnections', async () => (await import('./settingsMocks')).calendarConnModule())
vi.mock('@/lib/flags/mcpFlags', async () => (await import('./settingsMocks')).mcpFlagsModule())
vi.mock('@/lib/oauth/server/connections', async () => (await import('./settingsMocks')).aiConnectionsModule())
vi.mock('@/lib/oauth/server/config', async () => (await import('./settingsMocks')).oauthConfigModule())
vi.mock('@/lib/facebook/useEmbeddedSignup', async () => (await import('./settingsMocks')).embeddedSignupModule())
vi.mock('@/modules/inbox/client/useAdaptivePoll', async () => (await import('./settingsMocks')).adaptivePollModule())
vi.mock('@/actions/whatsapp/templates/createTemplate', async () => (await import('./settingsMocks')).templatesActionsModules.create())
vi.mock('@/actions/whatsapp/templates/retryTemplate', async () => (await import('./settingsMocks')).templatesActionsModules.retry())
vi.mock('@/actions/whatsapp/templates/archiveTemplate', async () => (await import('./settingsMocks')).templatesActionsModules.archive())
vi.mock('@/actions/whatsapp/templates/discardTemplate', async () => (await import('./settingsMocks')).templatesActionsModules.discard())
vi.mock('@/modules/messenger/profileActions', async () => (await import('./settingsMocks')).messengerProfileActionsModule())
vi.mock('@/modules/messenger/savedReplyActions', async () => (await import('./settingsMocks')).savedReplyActionsModule())
vi.mock('@/actions/oauthGrants', async () => (await import('./settingsMocks')).oauthGrantsActionsModule())

const norm = (html: string) => html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»')
const set = (overrides: Partial<typeof setEnv>) => Object.assign(setEnv, overrides)
const calls = () => JSON.parse(JSON.stringify(setEnv.calls))
const dialogs = () => norm([...document.querySelectorAll('[role="dialog"]')].map((d) => d.outerHTML).join('\n'))
const click = async (el: Element | null | undefined) => act(async () => void fireEvent.click(el!))
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const btn = (text: string) => screen.getAllByText(text).pop()!.closest('button')
const inDialog = (text: string) => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent === text)
const section = (id: string) => document.getElementById(id)!
async function mount() {
  return render(await setShell(null, await settingsPage('integrations')))
}
const fetchMock = (ok: boolean, json: unknown = {}) => vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => json }))

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetSetEnv()
  vi.unstubAllGlobals()
})

describe('Hebrew baseline — Facebook and WhatsApp connect', () => {
  test('Facebook: disconnect confirm → failure / success; Page picker → connect failure codes → success', async () => {
    const out: Record<string, unknown> = {}
    vi.stubGlobal('fetch', fetchMock(false))
    await mount()
    await click(btn('נתק דף'))
    out.disconnectDialog = dialogs()
    await click(inDialog('אישור'))
    await flush()
    vi.stubGlobal('fetch', fetchMock(true))
    await click(btn('נתק דף'))
    await click(inDialog('אישור'))
    await flush()
    cleanup()
    set({ fbPage: null, pendingPages: PENDING_PAGES, messenger: { visible: false } })
    await mount()
    const select = section('facebook').querySelector('select')!
    fireEvent.change(select, { target: { value: 'p2' } })
    for (const error of ['subscription_failed', 'resource_claimed', undefined]) {
      vi.stubGlobal('fetch', fetchMock(false, error ? { error } : {}))
      await click(section('facebook').querySelector('div[data-edu="facebook-connect"] button'))
      await flush()
      out[`connectFailed_${error ?? 'none'}`] = norm(section('facebook').querySelector('[role="status"]')!.outerHTML)
      out[`connectButton_${error ?? 'none'}`] = section('facebook').querySelector('div[data-edu="facebook-connect"] button')?.textContent
    }
    vi.stubGlobal('fetch', fetchMock(true))
    await click(section('facebook').querySelector('div[data-edu="facebook-connect"] button'))
    await flush()
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('WhatsApp: launch failures (Meta error with / without a documented step, SDK, not completed) on a live connection and when not connected; disconnect; number picker failure', async () => {
    const out: Record<string, unknown> = {}
    set({ waStatus: 'token' })
    await mount()
    const launches: Record<string, unknown> = {
      sdk: { ok: false, error: 'sdk' },
      metaDocumented: { ok: false, error: 'cancelled', cancel: { errorReported: true, errorMessage: 'This phone number is registered to an existing WhatsApp account.' } },
      metaUndocumented: { ok: false, error: 'cancelled', cancel: { errorReported: true, errorMessage: 'Unexpected Meta failure' } },
      verification: { ok: false, error: 'cancelled', cancel: { step: 'PHONE_NUMBER_VERIFICATION', errorReported: false } },
      network: { ok: false, error: 'network' },
    }
    for (const [name, launch] of Object.entries(launches)) {
      set({ results: { launch } })
      await click(section('whatsapp').querySelector('div[data-edu="whatsapp-connect"] button'))
      await flush()
      out[`live_${name}`] = norm(section('whatsapp').querySelector('[role="status"]')?.outerHTML ?? '')
    }
    await click(btn('נתק וואטסאפ'))
    out.disconnectDialog = dialogs()
    cleanup()
    set({ waConnection: null, waStatus: 'disconnected', results: {} })
    await mount()
    for (const [name, launch] of Object.entries({ ...launches, notCompleted: { ok: false, error: 'cancelled', cancel: { errorReported: false } } })) {
      set({ results: { launch } })
      await click(section('whatsapp').querySelector('div[data-edu="whatsapp-connect"] button'))
      await flush()
      out[`new_${name}`] = norm(section('whatsapp').querySelector('[role="status"]')?.outerHTML ?? '')
    }
    cleanup()
    set({ pendingPhones: PENDING_PHONES, results: {} })
    vi.stubGlobal('fetch', fetchMock(false))
    await mount()
    fireEvent.change(section('whatsapp').querySelector('select')!, { target: { value: 'ph1' } })
    await click(btn('חבר וואטסאפ'))
    await flush()
    out.phoneConnectFailed = norm(section('whatsapp').innerHTML)
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — ready-made messages', () => {
  test('create dialog, validation, create success / failure, archive, discard, retry and edit prefill', async () => {
    const out: Record<string, unknown> = {}
    await mount()
    await click(btn('הודעה מוכנה חדשה'))
    out.createDialog = dialogs()
    const dlg = () => document.querySelector('[role="dialog"]')!
    fireEvent.change(dlg().querySelector('input')!, { target: { value: 'תזכורת' } })
    fireEvent.change(dlg().querySelector('textarea')!, { target: { value: 'שלום {{1}}' } })
    await click(dlg().querySelector('input[type="radio"]'))
    await click(inDialog('שלח לבדיקה'))
    out.validation = norm(dlg().querySelector('[role="alert"]')!.outerHTML)
    await click([...dlg().querySelectorAll('button')].find((b) => b.textContent?.includes('שם הליד')))
    out.preview = norm(dlg().innerHTML)
    fireEvent.change(dlg().querySelector('textarea')!, { target: { value: 'שלום שם הליד' } })
    set({ results: { createTemplate: { ok: false, error: 'אין הרשאה ליצור הודעות WhatsApp מוכנות.' } } })
    await click(inDialog('שלח לבדיקה'))
    await flush()
    set({ results: {} })
    await click(btn('הודעה מוכנה חדשה'))
    fireEvent.change(dlg().querySelector('input')!, { target: { value: 'תזכורת' } })
    fireEvent.change(dlg().querySelector('textarea')!, { target: { value: 'שלום' } })
    await click(dlg().querySelectorAll('input[type="radio"]')[1])
    await click(inDialog('שלח לבדיקה'))
    await flush()
    await click(btn('ארכיון'))
    out.archiveDialog = dialogs()
    await click(inDialog('אישור'))
    await flush()
    set({ results: { discardTemplate: { ok: false, error: 'ההודעה לא נמצאה.' } } })
    await click(btn('הסר'))
    out.discardDialog = dialogs()
    await click(inDialog('אישור'))
    await flush()
    await click(btn('ערוך ונסה שוב'))
    out.retryDialog = dialogs()
    await click(inDialog('ביטול'))
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('empty state CTA opens the dialog; edit of an approved message shows the new-version note', async () => {
    const out: Record<string, unknown> = {}
    set({ templates: [], templateCounts: {} })
    await mount()
    await click(section('templates').querySelector('button'))
    out.fromEmpty = dialogs()
    cleanup()
    set({ templates: [{ id: 1, displayTitle: 'תזכורת פגישה', status: 'approved', bodyText: 'היי, מזכירים את הפגישה מחר.', variables: [], failureText: null, archived: false, createdAt: '2026-10-20T09:00:00.000Z', category: 'UTILITY' }] })
    await mount()
    await click(btn('עריכת הודעה'))
    out.editDialog = dialogs()
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — Messenger, Calendar, Drive, AI', () => {
  test('Messenger: save entry points (success, every failure reason), saved replies add / edit / every failure / delete', async () => {
    const out: Record<string, unknown> = {}
    await mount()
    const entry = section('messenger')
    for (const reason of ['not_enabled', 'forbidden', 'not_found', 'permission_missing', 'invalid', 'rate_limited', 'meta_error']) {
      set({ results: { updateMessengerProfile: { reason } } })
      await click(btn('שמור שינויים'))
      await flush()
      out[`entry_${reason}`] = entry.querySelector('[role="alert"]')?.textContent
    }
    set({ results: {} })
    await click(btn('שמור שינויים'))
    await flush()
    const replies = section('messenger-replies')
    await click(btn('הוסף תשובה שמורה'))
    out.draftForm = norm(replies.innerHTML)
    await click(btn('הוסף תשובה מהירה'))
    await click(btn('הוסף כפתור'))
    out.draftExpanded = norm(replies.innerHTML)
    for (const reason of ['not_enabled', 'forbidden', 'not_found', 'title_taken', 'empty', 'too_many', 'invalid']) {
      set({ results: { createSavedReply: { reason } } })
      await click(btn('שמור תשובה שמורה'))
      await flush()
      out[`reply_${reason}`] = replies.querySelector('[role="alert"]')?.textContent
    }
    set({ results: { createSavedReply: { reason: 'invalid', detail: 'כתובת הקישור בכפתור 1 אינה תקינה' } } })
    await click(btn('שמור תשובה שמורה'))
    await flush()
    out.replyDetail = replies.querySelector('[role="alert"]')?.textContent
    set({ results: {} })
    fireEvent.change(replies.querySelector('#sr-title')!, { target: { value: 'חדשה' } })
    await click(btn('שמור תשובה שמורה'))
    await flush()
    await click(replies.querySelector('[aria-label="עריכת שעות פעילות"]'))
    out.editForm = norm(replies.innerHTML)
    await click(btn('ביטול'))
    const confirmSpy = vi.fn(() => true)
    vi.stubGlobal('confirm', confirmSpy)
    await click(replies.querySelector('[aria-label="מחק את שעות פעילות"]'))
    await flush()
    out.confirmText = confirmSpy.mock.calls
    cleanup()
    set({ messenger: { ...setEnv.messenger, readFailed: true } })
    await mount()
    out.readFailed = section('messenger').textContent
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })

  test('Google Calendar / Drive / AI: disconnect dialogs and toasts, Drive status states, how-to disclosure', async () => {
    const out: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: !String(url).includes('disconnect'), json: async () => ({ connected: true, email: 'dana@gmail.test' }) })))
    await mount()
    await flush()
    out.driveConnected = norm(document.querySelectorAll('.grid.max-w-3xl > div')[1]!.outerHTML)
    const confirms = [...document.querySelectorAll('button')].filter((b) => b.textContent === 'נתק חשבון')
    await click(confirms[0])
    out.calendarDialog = dialogs()
    await click(inDialog('נתק חשבון'))
    await flush()
    await click(confirms[1])
    out.driveDialog = dialogs()
    await click(inDialog('נתק חשבון'))
    await flush()
    await click(btn('נתק את Claude'))
    out.aiDialog = dialogs()
    set({ results: { disconnectAiConnection: { ok: false } } })
    await click(inDialog('נתק את Claude'))
    await flush()
    set({ results: {} })
    await click(btn('נתק את Cursor'))
    await click(inDialog('נתק את Cursor'))
    await flush()
    await click(btn('הוראות חיבור'))
    out.howTo = norm(document.getElementById('ai-connections-howto')!.outerHTML)
    cleanup()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ connected: false }) })))
    await mount()
    await flush()
    out.driveDisconnected = norm(document.querySelectorAll('.grid.max-w-3xl > div')[1]!.outerHTML)
    out.calls = calls()
    expect(out).toMatchSnapshot()
  })
})
