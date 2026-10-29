// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { ALL_USERS, DEALS, DEALS_USER, NOW, resetDealsEnv } from './dealsEnv'
import { dealsSpies, resetDealsSpies } from './dealsMocks'
import { dealsShell } from './dealsHarness'
import { EXPIRED } from './leadTabsEnv'

/**
 * HEBREW BASELINE for the deal form (`SaleForm`), as every entry opens it: the
 * deals page (new / edit), the lead header's close-deal dialog
 * (`CloseDealBtn`). Recorded BEFORE Phase E2; Hebrew must stay byte-identical.
 * Every validation message, the product-exists confirmation, the new-lead
 * popover's errors and the exact `insertSale` / `upsertLead` arguments.
 */

vi.mock('next/navigation', async () => (await import('./dealsMocks')).navigationModule())
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }))
vi.mock('@/actions/saleForm', async () => (await import('./dealsMocks')).saleFormActionsModule())
vi.mock('@/actions/clients', async () => (await import('./dealsMocks')).clientsActionsModule())
vi.mock('@/lib/toast', async () => (await import('./dealsMocks')).toastModule())

const html = (el: Element | null) => {
  if (!el) throw new Error('element not found')
  return el.outerHTML.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}
const dialogs = () => Array.from(document.querySelectorAll('[role="dialog"]'))
const lastDialog = () => dialogs().at(-1) ?? null
const formProps = { user: DEALS_USER, officeGotPerm: [], saleId: undefined, allUsers: ALL_USERS }

async function openForm(curSale: unknown = null, ent = undefined as undefined | typeof EXPIRED) {
  const { default: SaleForm } = await import('@/components/sales/saleForm/SaleForm')
  const node = <SaleForm props={formProps as never} curSale={curSale as never} onClose={() => dealsSpies.calls.push(['onClose'])} />
  return render(await dealsShell(null, node, ent))
}

async function submit(container: HTMLElement) {
  await act(async () => {
    fireEvent.submit(container.querySelector('form')!)
  })
}
async function closeError() {
  await act(async () => {
    fireEvent.click(lastDialog()!.querySelector('button:last-of-type')!)
  })
}

beforeAll(() => {
  Object.assign(HTMLElement.prototype, { showPopover() {}, hidePopover() {}, togglePopover() {} })
  window.scrollTo = () => {}
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())
afterEach(() => {
  cleanup()
  resetDealsEnv()
  resetDealsSpies()
})

describe('Hebrew baseline — deal form', () => {
  test('new deal: whole form (incl. hidden rep / sale-detail section), second product, remove product', async () => {
    const { container } = await openForm()
    const out: Record<string, string> = {}
    out.form = html(container.querySelector('form'))
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'מוצר נוסף')!)
    out.secondProduct = html(container.querySelectorAll('fieldset')[1])
    out.removeButton = html(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'הסרת מוצר')!)
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'שת"פ')!)
    out.collab = html(container.querySelector('section.hidden'))
    const other = container.querySelector('section.hidden input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(other)
    out.otherSource = html(container.querySelector('section.hidden'))
    expect(out).toMatchSnapshot()
  })

  test('edit deal (legacy status, courses branch, joining): pre-filled form', async () => {
    const { container } = await openForm({ ...DEALS[6], branch: 'קורסים', prdct: 'סדנה', action: 'הצטרפות', notes: 'הערה פנימית' })
    expect(html(container.querySelector('form'))).toMatchSnapshot()
  })

  test('every validation message, the product-exists confirmation and the insertSale arguments', async () => {
    const out: Record<string, unknown> = {}
    let { container } = await openForm()
    await submit(container)
    out.noLead = html(lastDialog())
    await closeError()
    cleanup()
    ;({ container } = await openForm(DEALS[0]))
    const amount = container.querySelector('input[name="prdcts[0].amount"]') as HTMLInputElement
    fireEvent.change(amount, { target: { value: '' } })
    await submit(container)
    out.noAmount = html(lastDialog())
    await closeError()
    fireEvent.change(amount, { target: { value: '20000000' } })
    await submit(container)
    out.tooHigh = html(lastDialog())
    await closeError()
    fireEvent.change(amount, { target: { value: '4500' } })
    const rep = container.querySelector('input[name="users.userId"]:not([role])') as HTMLInputElement | null
    const repValue = rep?.value
    if (rep) rep.value = ''
    await submit(container)
    out.noRep = html(lastDialog())
    await closeError()
    if (rep) rep.value = repValue ?? ''
    dealsSpies.isPrdctsExists.mockImplementation(async () => 'המוצרים הבאים כבר קיימים ללקוח:\nבניית אתר\n\nהאם להמשיך?')
    await submit(container)
    out.exists = html(lastDialog())
    await act(async () => {
      fireEvent.click(Array.from(lastDialog()!.querySelectorAll('button')).at(-1)!)
    })
    out.calls = dealsSpies.calls
    out.toasts = dealsSpies.toasts
    out.pushes = dealsSpies.pushes
    expect(out).toMatchSnapshot()
  })

  test('collaboration with the same rep twice', async () => {
    const { container } = await openForm(DEALS[1])
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'שת"פ')!)
    const second = container.querySelector('input[name="users.user2Id"]:not([role])') as HTMLInputElement | null
    const first = container.querySelector('input[name="users.userId"]:not([role])') as HTMLInputElement | null
    if (second && first) second.value = first.value
    await submit(container)
    expect(html(lastDialog())).toMatchSnapshot()
  })

  test('new-lead popover: empty, invalid id, existing id, server refusal, created', async () => {
    const { container } = await openForm()
    const out: Record<string, unknown> = {}
    const pop = document.getElementById('clientSaleForm')!
    out.pop = html(pop)
    const save = () => act(async () => fireEvent.click(Array.from(pop.querySelectorAll('button')).find((b) => b.textContent === 'שמירה')!))
    const set = (name: string, value: string) => fireEvent.change(pop.querySelector(`input[name="${name}"]`)!, { target: { value } })
    await save()
    out.empty = html(lastDialog())
    await closeError()
    set('firstName', 'נועה')
    set('lastName', 'ברק')
    set('idNum', '123456788')
    await save()
    out.invalidId = html(lastDialog())
    await closeError()
    set('idNum', '123456782')
    dealsSpies.getLeadByIdNum.mockImplementation(async () => ({ name: 'נועה ברק' }))
    await save()
    out.existing = html(lastDialog())
    await closeError()
    dealsSpies.getLeadByIdNum.mockImplementation(async () => null)
    dealsSpies.upsertLead.mockImplementation(async () => ({ err: true, msg: 'השרת סירב' }))
    await save()
    out.refused = html(lastDialog())
    await closeError()
    dealsSpies.upsertLead.mockImplementation(async () => ({ id: 91, details: 'נועה ברק' }))
    await save()
    out.created = html(container.querySelector('form section.flex'))
    out.calls = dealsSpies.calls
    expect(out).toMatchSnapshot()
  })

  test('expired: the lock panel instead of the form', async () => {
    const { container } = await openForm(null, EXPIRED)
    expect(container.innerHTML.replace(/«[^»]*»/g, '«id»')).toMatchSnapshot()
  })
})

describe('Hebrew baseline — close-deal dialog (lead header)', () => {
  test('the dialog and its form', async () => {
    const { default: CloseDealBtn } = await import('@/components/clientPage/CloseDealBtn')
    const { container } = render(await dealsShell(null, <CloseDealBtn clientId={41} clientName='מירב כהן 1' formProps={formProps} />))
    fireEvent.click(container.querySelector('button')!)
    expect(html(lastDialog())).toMatchSnapshot()
  })
})
