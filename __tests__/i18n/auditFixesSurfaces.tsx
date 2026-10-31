import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { UiLocale } from '@/lib/i18n/config'
import { INVOICES } from './leadTabsEnv'

/**
 * Renders for the final UI audit fixes (icon chooser's emoji picker, header
 * alignment, icon-only button names, the uploader's failure line, toasts),
 * shared by `auditFixesHebrewBaseline` (recorded on unmodified code) and
 * `auditFixesLocales`. `null` = no provider at all (the pre-i18n render); a
 * locale = the component under `I18nProvider` in that language. Each returns
 * the HTML of the element the fix touches.
 */

export const AUDIT_USER = { id: 7, agencyId: 103, name: 'דנה כהן', role: 'admin' }

/** `next/dynamic` for these renders: the ssr:false emoji picker becomes a stub showing its loading line and props. */
export function auditDynamicMock(_loader: () => Promise<unknown>, opts?: { loading?: () => ReactNode }) {
  return function DynamicStub(props: { searchPlaceHolder?: string }) {
    return (
      <>
        {opts?.loading?.()}
        <div data-stub='dynamic' data-search={props.searchPlaceHolder ?? ''} />
      </>
    )
  }
}

async function wrap(locale: UiLocale | null, node: ReactNode): Promise<ReactNode> {
  const { UserProvider } = await import('@/lib/hooksNEvents')
  const inner = <UserProvider user={AUDIT_USER}>{node}</UserProvider>
  if (!locale) return inner
  const { I18nProvider } = await import('@/lib/i18n/I18nProvider')
  return (
    <I18nProvider locale={locale} persistLocale={false}>
      {inner}
    </I18nProvider>
  )
}

const html = (el: Element | null | undefined) => (el ? el.outerHTML : '(missing)')
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))

/** A: the questionnaire icon chooser with its palette and the full emoji picker open. */
export async function iconPicker(locale: UiLocale | null): Promise<string> {
  const { default: IconChooser } = await import('@/components/settings/questionnaire/IconChooser')
  const view = render(await wrap(locale, <IconChooser icon={undefined} answerName='איפור' onChange={() => {}} />))
  await act(async () => void fireEvent.click(view.container.querySelector('button[aria-haspopup="dialog"]')!))
  const footer = view.container.querySelectorAll('.border-t button')
  await act(async () => void fireEvent.click(footer[footer.length - 1]))
  const out = html(view.container.querySelector('[role="dialog"] [role="dialog"]'))
  cleanup()
  return out
}

/** D: the header rows / option buttons whose alignment was hard-coded to the right. */
export async function alignment(locale: UiLocale | null): Promise<Record<string, string>> {
  const { default: LeadBillingList } = await import('@/components/billing/LeadBillingList')
  const { default: AdsDailyTrend } = await import('@/modules/adsReporting/components/AdsDailyTrend')
  const { default: AdsResultsTable } = await import('@/modules/adsReporting/components/AdsResultsTable')
  const { default: DocumentKindPicker } = await import('@/components/billing/document-picker/DocumentKindPicker')
  const l = locale ?? undefined
  const out: Record<string, string> = {}
  let v = render(await wrap(locale, <LeadBillingList leadId={41} invoices={INVOICES as never} canCreate={false} locale={l} />))
  out.billingHead = html(v.container.querySelector('thead'))
  cleanup()
  v = render(await wrap(locale, <AdsDailyTrend daily={[{ date: '2026-10-01', spend: 12.5, linkClicks: 3, leads: 1 }] as never} currency='USD' showLeads locale={l} />))
  out.trendHead = html(v.container.querySelector('thead'))
  cleanup()
  const row = { id: 'c1', name: 'קמפיין סתיו', objective: 'OUTCOME_LEADS', status: 'ACTIVE', metrics: { spend: 10, linkClicks: 4, linkCtr: 1.2, reach: 300 }, result: { kind: 'leads', count: 2, cost: 5 } }
  v = render(await wrap(locale, <AdsResultsTable title='קמפיינים' rows={[row] as never} currency='USD' nameHeader='קמפיין' emptyText='-' statusesAvailable locale={l} />))
  out.resultsHead = html(v.container.querySelector('thead'))
  cleanup()
  render(await wrap(locale, <DocumentKindPicker open onClose={() => {}} onPick={() => {}} />))
  await flush()
  out.kindOptions = html(document.querySelector('[role="dialog"] ul'))
  cleanup()
  return out
}

/** E: the icon-only close button of the lead files upload form and the campaign goal +/- buttons. */
export async function iconButtons(locale: UiLocale | null): Promise<Record<string, string>> {
  const { default: FileForm } = await import('@/components/files/FileForm')
  const { default: AddPromoForm } = await import('@/components/promo/AddPromoForm')
  const out: Record<string, string> = {}
  let v = render(await wrap(locale, <FileForm clientId={41} tasks={[]} />))
  out.fileFormClose = html(v.container.querySelector('#filePopover > button'))
  cleanup()
  const promo = { id: 3, title: 'x', isPromoGrp: false, goals: { target: { a: [1, 2] }, prize: ['p1', 'p2'], conditions: [] } }
  v = render(await wrap(locale, <AddPromoForm teams={[]} users={[]} promo={promo} setcurPromo={() => {}} />))
  const goal = [...v.container.querySelectorAll('button[type="button"]')].filter((b) => b.querySelector('[style*="plus.svg"], [style*="minus.svg"]'))
  out.goalButtons = goal.map(html).join('\n')
  cleanup()
  return out
}

/** H: the uploader's failure line for a file over the size limit and for an empty selection. */
export async function uploaderFailures(locale: UiLocale | null): Promise<Record<string, string>> {
  const { default: FileUploader } = await import('@/components/files/FileUploader')
  const out: Record<string, string> = {}
  const big = new File(['x'], 'big.pdf', { type: 'application/pdf' })
  Object.defineProperty(big, 'size', { value: 10_000_001 })
  for (const [name, files] of [
    ['tooLarge', [big]],
    ['noneSelected', []],
  ] as const) {
    const v = render(await wrap(locale, <FileUploader translated />))
    await act(async () => void fireEvent.change(v.container.querySelector('input[type="file"]')!, { target: { files } }))
    await flush()
    out[name] = html(document.querySelector('[role="dialog"], [role="alertdialog"]'))
    cleanup()
  }
  return out
}

/** G: the toast body for an interface-language sentence, a verbatim Hebrew sentence and a default. */
export async function toastBodies(locale: UiLocale | null, sentence: string): Promise<Record<string, string>> {
  const toastMod = await import('@/lib/toast')
  const ToastMsg = toastMod.default
  const v = render(
    <>
      <ToastMsg />
      {await wrap(locale, <span />)}
    </>,
  )
  const out: Record<string, string> = {}
  for (const [name, msg] of [
    ['sentence', sentence],
    ['verbatimHebrew', 'הליד נשמר בהצלחה'],
    ['default', undefined],
  ] as const) {
    act(() => toastMod.toast('success', msg))
    out[name] = html(document.getElementById('popMsg'))
  }
  v.unmount()
  cleanup()
  return out
}

/** C: the phone ready-messages rows' trailing chevron (class of each row's last icon). */
export async function readyMessageChevrons(locale: UiLocale | null): Promise<string[]> {
  const { default: ReadyMessagesWorkspace } = await import('@/modules/templates/mobile/ReadyMessagesWorkspace')
  const tpl = (id: number, status: string) => ({ id, displayTitle: 'תזכורת', status, bodyText: 'תוכן', variables: [], failureText: null, archived: false, createdAt: '2026-07-23T00:00:00Z' })
  const v = render(await wrap(locale, <ReadyMessagesWorkspace initial={[tpl(1, 'approved'), tpl(2, 'pending')] as never} />))
  const rows = [...v.container.querySelectorAll('.divide-y > button')]
  const out = rows.map((r) => [...r.querySelectorAll('[aria-hidden="true"]')].pop()!.getAttribute('class')!)
  cleanup()
  return out
}
