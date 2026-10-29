// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { renderToString as renderRaw } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { CLIENT_LISTS, NOW, ROWS, TBL_PREF_USER, USERS, makeLead } from './leadsFixtures'

/**
 * HEBREW BASELINE for the /leads and /clients LIST surfaces. Recorded against
 * the code BEFORE Phase C; every Hebrew render and every label producer must
 * still match byte-for-byte afterwards. A diff here is a change to what
 * existing customers read.
 *
 * Normalized before comparing, and only these:
 *  · React's invisible `<!-- -->` text separators (see renderToString).
 *  · React `useId` values. They encode the component tree's SHAPE, not
 *    anything a user reads, so a pure file split must not be able to move them.
 */

const H = vi.hoisted(() => ({
  url: { search: '' },
  user: null as Record<string, unknown> | null,
  accessDenied: false,
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(H.url.search),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/leads',
  redirect: (to: string) => {
    throw new Error('REDIRECT ' + to)
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {}, cacheTag: () => {}, unstable_cache: (fn: unknown) => fn }))
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => null, set: () => {}, delete: () => {} }), headers: () => ({ get: () => null }) }))
vi.mock('@/actions/clients', () => ({
  updateLead: async () => ({ ok: true }),
  deleteLead: async () => ({ ok: true }),
  deleteManyLeads: async () => ({ deleted: 0 }),
  assignLeadsToRep: async () => ({ ok: true }),
  transferLeadToRep: async () => ({ ok: true }),
  searchContacts: async () => [],
  searchLeads: async () => [],
  getLeadByIdNum: async () => null,
  upsertLead: async () => ({ ok: true }),
  addLeads: async () => ({ inserted: 0 }),
  importLeadsFromCsv: async () => ({ inserted: 0 }),
  uploadLeadData: async () => ({}),
  upsertLeadList: async () => ({}),
  deleteLeadList: async () => ({}),
}))
vi.mock('@/actions/global', () => ({ saveTblPref: async () => ({ ok: true }) }))
vi.mock('@/actions/leadDuplicates', () => ({ findDuplicateLeads: async () => [] }))
vi.mock('@/actions/analytics/recordFirstLeadEvent', () => ({ recordFirstLeadEvent: async () => {} }))
vi.mock('@/actions/analytics/recordLeadActionEvent', () => ({ recordLeadActionEvent: async () => {} }))
vi.mock('@/lib/toast', () => ({ toast: () => {}, proToast: () => {} }))
vi.mock('@/lib/entitlement/pollGate', async () => {
  const actual = await vi.importActual<typeof import('@/lib/entitlement/pollGate')>('@/lib/entitlement/pollGate')
  return { ...actual, isAccessDenied: () => H.accessDenied }
})
vi.mock('@/lib/hooksNEvents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hooksNEvents')>('@/lib/hooksNEvents')
  const { CLIENT_LISTS: lists, ROWS: rows, USERS: users } = await import('./leadsFixtures')
  return {
    ...actual,
    useLeadPolling: () => {},
    useKeepTblScrollPos: () => {},
    useUser: () => H.user,
    useProps: () => ({ tableLength: rows.length, clientLists: lists, params: Object.fromEntries(new URLSearchParams(H.url.search)), clients: rows, users, handlers: users }),
  }
})

const { default: ClientsTable, getHeaders } = await import('@/components/clients/clientsTable')

function normalizeIds(html: string) {
  return html.replace(/«[^»]*»/g, '«id»').replace(/_[rR]_[0-9a-zA-Z]*_/g, '«id»').replace(/:r[0-9a-z]+:/g, '«id»')
}

/** React separates adjacent text nodes with `<!-- -->` in server HTML; not user-visible. */
function renderToString(node: Parameters<typeof renderRaw>[0]) {
  return normalizeIds(renderRaw(node).replaceAll('<!-- -->', ''))
}

function html(el: Element | null) {
  if (!el) throw new Error('element not found')
  return normalizeIds(el.innerHTML)
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => {
  vi.useRealTimers()
})
afterEach(() => {
  cleanup()
  H.url.search = ''
  H.user = null
  H.accessDenied = false
})

const TAB = { new: /^חדש\b/, contacted: /^בטיפול\b/, interested: /^מעוניין\b/, closed: /^סגור\b/, lost: /^אבוד\b/ } as const

describe('Hebrew baseline — ClientsTable (server HTML)', () => {
  test('leads, every status and source, default columns', () => {
    expect(renderToString(<ClientsTable data={ROWS} user={null} leads={true} whatsappConnected />)).toMatchSnapshot()
  })

  test('clients (leads=false)', () => {
    expect(renderToString(<ClientsTable data={ROWS} user={null} leads={false} />)).toMatchSnapshot()
  })

  test('leads with a saved tblPref carrying stored Hebrew labels, all optional columns available', () => {
    const availability = { idNum: true, secPhone: true, birthDate: true, gender: true }
    expect(renderToString(<ClientsTable data={ROWS} user={TBL_PREF_USER} leads={true} columnAvailability={availability} />)).toMatchSnapshot()
  })

  test('search scope (?q=), several results and one result', () => {
    H.url.search = 'q=' + encodeURIComponent('דנה')
    const many = renderToString(<ClientsTable data={ROWS.slice(0, 2)} user={null} leads={true} />)
    const one = renderToString(<ClientsTable data={ROWS.slice(0, 1)} user={null} leads={true} />)
    expect([many, one]).toMatchSnapshot()
  })

  test('empty table: workspace, search, saved list; leads and clients', () => {
    const out: string[] = []
    out.push(renderToString(<ClientsTable data={[]} user={null} leads={true} />))
    out.push(renderToString(<ClientsTable data={[]} user={null} leads={false} />))
    H.url.search = 'q=' + encodeURIComponent('אין כזה')
    out.push(renderToString(<ClientsTable data={[]} user={null} leads={true} />))
    H.url.search = 'listId=31'
    out.push(renderToString(<ClientsTable data={[]} user={null} leads={true} />))
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — ClientsTable (interactive states)', () => {
  test('each status tab', () => {
    const { container } = render(<ClientsTable data={ROWS} user={null} leads={true} />)
    const out: Record<string, string> = {}
    for (const [status, name] of Object.entries(TAB)) {
      fireEvent.click(screen.getByRole('button', { name }))
      out[status] = html(container.querySelector('table'))
    }
    expect(out).toMatchSnapshot()
  })

  test('row actions menu for every status, and the delete confirmation', () => {
    const { container } = render(<ClientsTable data={ROWS} user={null} leads={true} formProps={{}} />)
    const out: Record<string, string> = {}
    for (const [status, name] of Object.entries(TAB)) {
      fireEvent.click(screen.getByRole('button', { name }))
      const dots = container.querySelector('tbody button[aria-label="פעולות"]')!
      fireEvent.click(dots)
      out[status] = html(document.getElementById('clientActions'))
    }
    // Lead without a phone: no call / WhatsApp entries.
    fireEvent.click(screen.getByRole('button', { name: TAB.new }))
    const rows = container.querySelectorAll('tbody button[aria-label="פעולות"]')
    fireEvent.click(rows[rows.length - 1])
    out.newNoPhone = html(document.getElementById('clientActions'))
    // The single-lead delete confirmation.
    const del = Array.from(document.getElementById('clientActions')!.querySelectorAll('button')).find((b) => b.textContent === 'מחיקה')!
    fireEvent.click(del)
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => d.textContent?.includes('האם למחוק'))
    out.confirmDelete = dialog ? normalizeIds(dialog.outerHTML) : 'NO DIALOG'
    expect(out).toMatchSnapshot()
  })

  test('toolbar with a selection (bulk assign / delete labels), leads and clients', () => {
    const out: string[] = []
    for (const leads of [true, false]) {
      const { container, unmount } = render(<ClientsTable data={ROWS} user={null} leads={leads} />)
      const boxes = container.querySelectorAll<HTMLInputElement>("tbody [name='checkRow']")
      act(() => {
        boxes[0].checked = true
        boxes[0].dispatchEvent(new Event('change', { bubbles: true }))
      })
      out.push(html(container.querySelector('[data-edu="leads-table"]') ?? container.firstElementChild?.nextElementSibling ?? null))
      if (leads) {
        act(() => {
          boxes.forEach((b) => {
            b.checked = true
            b.dispatchEvent(new Event('change', { bubbles: true }))
          })
        })
        out.push(html(container.querySelector('[data-edu="leads-table"]')))
      }
      unmount()
    }
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — list-page components', () => {
  test('LeadsTableEmptyState variants', async () => {
    const { default: LeadsTableEmptyState } = await import('@/components/clients/LeadsTableEmptyState')
    const noop = () => {}
    const base = { filteredCount: 0, activeTab: 'new', setActiveTab: noop, onClearScope: noop, onAddLead: noop, onUploadLeads: noop }
    const rows = [{ status: 'contacted' }, { status: 'contacted' }, { status: 'lost' }]
    expect({
      workspaceLeads: renderToString(<LeadsTableEmptyState {...base} leads rows={[]} scoped={false} />),
      workspaceClients: renderToString(<LeadsTableEmptyState {...base} leads={false} rows={[]} scoped={false} />),
      scopedSearchLeads: renderToString(<LeadsTableEmptyState {...base} leads rows={[]} scoped scopeKind='search' />),
      scopedFilterLeads: renderToString(<LeadsTableEmptyState {...base} leads rows={[]} scoped scopeKind='filter' />),
      scopedSearchClients: renderToString(<LeadsTableEmptyState {...base} leads={false} rows={[]} scoped scopeKind='search' />),
      scopedFilterClients: renderToString(<LeadsTableEmptyState {...base} leads={false} rows={[]} scoped scopeKind='filter' />),
      tabEmptyNew: renderToString(<LeadsTableEmptyState {...base} leads rows={rows} scoped={false} />),
      tabEmptyInterested: renderToString(<LeadsTableEmptyState {...base} leads rows={rows} activeTab='interested' scoped={false} />),
      tabEmptyClosed: renderToString(<LeadsTableEmptyState {...base} leads rows={[{ status: 'lost' }]} activeTab='closed' scoped={false} />),
      notEmpty: renderToString(<LeadsTableEmptyState {...base} leads filteredCount={2} rows={rows} scoped={false} />),
    }).toMatchSnapshot()
  })

  test('LeadsFirstRun and LeadsFirstRunMobile, every connection combination', async () => {
    const { default: LeadsFirstRun } = await import('@/components/clients/LeadsFirstRun')
    const { default: LeadsFirstRunMobile } = await import('@/modules/leads/mobile/LeadsFirstRunMobile')
    const out: Record<string, string> = {}
    for (const metaConnected of [false, true]) {
      for (const whatsappConnected of [false, true]) {
        const k = `meta=${metaConnected},wa=${whatsappConnected}`
        out[`desktop ${k}`] = renderToString(<LeadsFirstRun metaConnected={metaConnected} whatsappConnected={whatsappConnected} />)
        out[`mobile ${k}`] = renderToString(<LeadsFirstRunMobile metaConnected={metaConnected} whatsappConnected={whatsappConnected} />)
      }
    }
    expect(out).toMatchSnapshot()
  })

  test('banners: first import, Meta disconnected, intake, over quota', async () => {
    const { default: FirstImportCallout } = await import('@/components/clients/FirstImportCallout')
    const { default: MetaDisconnectedBanner } = await import('@/components/clients/MetaDisconnectedBanner')
    const { default: LeadIntakeBanner } = await import('@/components/clients/LeadIntakeBanner')
    const { default: OverQuotaBanner } = await import('@/components/quota/OverQuotaBanner')
    const { INTAKE_ERRORS } = await import('@/lib/automations/connectors/intakeErrors')
    const alerts = Object.values(INTAKE_ERRORS).map((c, i) => ({ connectionId: `contact_form_7:${i + 1}`, title: c!.title, short: c!.short, action: c!.action }))
    expect({
      firstImportNone: renderToString(<FirstImportCallout count={0} />),
      firstImportOne: renderToString(<FirstImportCallout count={1} leadId={5} />),
      firstImportMany: renderToString(<FirstImportCallout count={24} leadId={5} />),
      firstImportSkipped: renderToString(<FirstImportCallout count={24} leadId={5} skipped={3} />),
      firstImportSkippedOne: renderToString(<FirstImportCallout count={2} skipped={1} />),
      metaHidden: renderToString(<MetaDisconnectedBanner show={false} />),
      metaShown: renderToString(<MetaDisconnectedBanner show />),
      intakeNone: renderToString(<LeadIntakeBanner alerts={[]} />),
      intakeEach: alerts.map((a) => renderToString(<LeadIntakeBanner alerts={[a]} />)),
      intakeWithAction: renderToString(<LeadIntakeBanner alerts={[{ ...alerts[0], action: { label: 'לתיקון החיבור', href: '/settings/integrations' } }]} />),
      overQuotaNone: renderToString(<OverQuotaBanner count={0} />),
      overQuota: renderToString(<OverQuotaBanner count={13} />),
    }).toMatchSnapshot()
  })

  test('CrmSyncBanner: connection problem with and without retry, subscription lapsed', async () => {
    const { CrmSyncHealthProvider, useCrmSyncHealth } = await import('@/lib/polling/CrmSyncHealthContext')
    const { default: CrmSyncBanner } = await import('@/components/clients/CrmSyncBanner')
    function Seed({ retry }: { retry?: () => void }) {
      const { report } = useCrmSyncHealth()
      useEffect(() => {
        report('leads', 3, retry ?? null)
      }, [retry, report])
      return null
    }
    const out: Record<string, string> = {}
    for (const [k, retry, compact, denied] of [
      ['retry', () => {}, false, false],
      ['noRetry', undefined, false, false],
      ['compact', () => {}, true, false],
      ['lapsed', () => {}, false, true],
    ] as const) {
      H.accessDenied = denied
      const { container, unmount } = render(
        <CrmSyncHealthProvider>
          <Seed retry={retry} />
          <CrmSyncBanner sources={['leads', 'awareness']} compact={compact} />
        </CrmSyncHealthProvider>,
      )
      out[k] = html(container)
      unmount()
    }
    expect(out).toMatchSnapshot()
  })

  test('ClientFormPop add and edit, DuplicateLeadBanner', async () => {
    H.user = TBL_PREF_USER
    const { default: ClientFormPop } = await import('@/components/clients/ClientFormPop')
    const { default: DuplicateLeadBanner } = await import('@/components/clients/DuplicateLeadBanner')
    const edit = makeLead({ id: 4, firstName: 'אבי', lastName: 'מזרחי', idNum: '123456782', secPhone: '0529876543', birthDate: '1990-05-01', gender: 'male' })
    const matches = [
      { id: 9, name: 'אבי מזרחי', status: 'contacted', phone: '0501234567', email: 'avi@example.test', confidence: 'certain' as const, signals: ['phone', 'idNum'] as ('phone' | 'idNum')[] },
      { id: 10, name: '', status: 'lost', phone: null, email: 'x@example.test', confidence: 'probable' as const, signals: ['email'] as 'email'[] },
    ]
    expect({
      add: renderToString(<ClientFormPop />),
      edit: renderToString(<ClientFormPop client={edit} />),
      dupStrong: renderToString(<DuplicateLeadBanner matches={matches} onDismiss={() => {}} />),
      dupSoft: renderToString(<DuplicateLeadBanner matches={[matches[1], { ...matches[1], id: 11, name: 'רונית', status: 'interested' }, { ...matches[1], id: 12, name: 'רון', status: 'closed' }, { ...matches[1], id: 13, name: 'רז', status: 'new' }, { ...matches[1], id: 14, name: 'רם', status: 'weird' }]} onDismiss={() => {}} />),
    }).toMatchSnapshot()
  })

  test('BulkAssignLeadsForm, TransferClientForm, SelectClientLists, listForm', async () => {
    H.user = TBL_PREF_USER
    const { default: BulkAssignLeadsForm } = await import('@/components/clients/BulkAssignLeadsForm')
    const { default: TransferClientForm } = await import('@/components/clients/TransferClientForm')
    const { default: SelectClientLists } = await import('@/components/clients/SelectClientLists')
    const { default: ListForm } = await import('@/components/clients/listForm')
    const out: Record<string, string> = {
      bulkAssignOne: renderToString(<BulkAssignLeadsForm count={1} onAssign={() => {}} onCancel={() => {}} />),
      bulkAssignMany: renderToString(<BulkAssignLeadsForm count={7} onAssign={() => {}} onCancel={() => {}} />),
      transfer: renderToString(<TransferClientForm client={ROWS[0]} />),
      lists: renderToString(<SelectClientLists />),
      listFormNew: renderToString(<ListForm />),
    }
    H.url.search = 'listId=31'
    out.listsSelected = renderToString(<SelectClientLists />)
    out.listFormEdit = renderToString(<ListForm />)
    expect(out).toMatchSnapshot()
  })

  test('UploadClientData (file and paste tabs), PasteLeadsPanel', async () => {
    const { default: UploadClientData } = await import('@/components/settings/UploadClientData')
    const { default: PasteLeadsPanel } = await import('@/components/clients/PasteLeadsPanel')
    const out: Record<string, string> = {
      uploadFile: renderToString(<UploadClientData />),
      paste: renderToString(<PasteLeadsPanel />),
    }
    const { container, unmount } = render(<UploadClientData />)
    const pasteTab = Array.from(container.querySelectorAll('button')).find((b) => /הדבק/.test(b.textContent ?? ''))
    if (pasteTab) fireEvent.click(pasteTab)
    out.uploadPasteTab = html(container)
    unmount()
    const panel = render(<PasteLeadsPanel />)
    const area = panel.container.querySelector('textarea')!
    fireEvent.change(area, { target: { value: '0501234567\n0527654321\nלא טלפון\n' } })
    out.pasteTyped = html(panel.container)
    fireEvent.change(area, { target: { value: '0501234567' } })
    out.pasteTypedOne = html(panel.container)
    expect(out).toMatchSnapshot()
  })
})

describe('Hebrew baseline — label producers (default arguments)', () => {
  test('headers, statuses, sources, deal labels, delete reasons, inbound copy, intake copy', async () => {
    const { STATUS_STYLES, STATUS_OPTIONS, statusStyle } = await import('@/lib/leads/statusStyles')
    const { LEAD_BLOCK_REASON_TEXT, blockReasonText, deleteLeadsMessage } = await import('@/lib/leads/deleteResult')
    const { INBOUND_LEAD_COPY, CAPTURED_FIELD_LABELS } = await import('@/lib/leads/inboundLeadCopy')
    const { INTAKE_ERRORS, intakeErrorCopy } = await import('@/lib/automations/connectors/intakeErrors')
    const { leadSourceLabel } = await import('@/lib/leads/leadSourceLabel')
    const funcs = await import('@/components/clients/funcs')
    const statuses = ['new', 'contacted', 'interested', 'closed', 'lost', undefined]
    const blocks = Object.keys(LEAD_BLOCK_REASON_TEXT) as (keyof typeof LEAD_BLOCK_REASON_TEXT)[]
    expect({
      headers: {
        leadsSingleUser: getHeaders(true, false),
        leadsMultiUser: getHeaders(true),
        clientsSingleUser: getHeaders(false, false),
        clientsMultiUser: getHeaders(false),
      },
      statusLabels: Object.fromEntries(Object.entries(STATUS_STYLES).map(([k, v]) => [k, v.label])),
      statusOptions: STATUS_OPTIONS,
      statusFallback: [statusStyle(null).label, statusStyle('weird').label],
      sources: ['whatsapp:972501234567', 'facebook:1', 'instagram:1', 'contact_form_7:3:x', 'website', 'manual', null, '', 'utm_campaign_spring'].map((s) => leadSourceLabel(s)),
      dealLabels: statuses.map((s) => funcs.getDealActionLabel(s)),
      blockReasons: blocks.map((b) => blockReasonText(b)),
      deleteMessages: [
        { deletedCount: 0, blockedCount: 0, blockedLeads: [] },
        { deletedCount: 1, blockedCount: 0, blockedLeads: [] },
        { deletedCount: 5, blockedCount: 0, blockedLeads: [] },
        ...blocks.map((reason) => ({ deletedCount: 0, blockedCount: 1, blockedLeads: [{ id: 1, name: 'א', reason }] })),
        ...blocks.map((reason) => ({ deletedCount: 1, blockedCount: 1, blockedLeads: [{ id: 1, name: 'א', reason }] })),
        { deletedCount: 3, blockedCount: 2, blockedLeads: [{ id: 1, name: 'א', reason: blocks[0] }, { id: 2, name: 'ב', reason: blocks[1] }] },
        { deletedCount: 0, blockedCount: 4, blockedLeads: [] },
      ].map((r) => deleteLeadsMessage(r)),
      inbound: { INBOUND_LEAD_COPY, CAPTURED_FIELD_LABELS },
      intake: { INTAKE_ERRORS, lookups: ['invalid_signature', 'unreadable_payload', 'unknown', null].map((r) => intakeErrorCopy(r)) },
    }).toMatchSnapshot()
  })
})
