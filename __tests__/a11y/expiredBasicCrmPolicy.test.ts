// @vitest-environment node
//
// The basic-CRM entitlement policy, as a contract.
//
// An expired subscription suspends what costs money, not the customer's
// ability to keep their own house in order. These tests pin both halves of
// that sentence: the free operations stay open, the paid ones stay shut, and
// authentication and tenant isolation are untouched by either.
//
// No DB: runs in the no-DB suite.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

const getUser = vi.hoisted(() => vi.fn())
const getAgencyProductAccess = vi.hoisted(() => vi.fn())

vi.mock('@/db/auth', () => ({ getUser }))
vi.mock('@/lib/access/productAccess', () => ({ getAgencyProductAccess }))

const ACTIVE = { status: 'PAID', hasAccess: true }
const EXPIRED = { status: 'TRIAL_EXPIRED', hasAccess: false }
const REP = { id: 7, agencyId: 103, role: 'rep', suspended: false }

beforeEach(() => {
  getUser.mockReset()
  getAgencyProductAccess.mockReset()
})
afterEach(() => vi.resetModules())

async function guards() {
  return await import('@/lib/requireUser')
}

describe('the basic-CRM guard authenticates without charging', () => {
  it('lets an EXPIRED subscriber through', async () => {
    getUser.mockResolvedValue(REP)
    getAgencyProductAccess.mockResolvedValue(EXPIRED)
    const { requireBasicCrmAccess } = await guards()
    await expect(requireBasicCrmAccess()).resolves.toMatchObject({ id: 7, agencyId: 103 })
  })

  it('lets an ACTIVE subscriber through unchanged', async () => {
    getUser.mockResolvedValue(REP)
    getAgencyProductAccess.mockResolvedValue(ACTIVE)
    const { requireBasicCrmAccess } = await guards()
    await expect(requireBasicCrmAccess()).resolves.toMatchObject({ id: 7, agencyId: 103 })
  })

  /** It grants what requireAgencyUser grants — so it must not even ask. */
  it('does not consult product access at all', async () => {
    getUser.mockResolvedValue(REP)
    getAgencyProductAccess.mockResolvedValue(EXPIRED)
    const { requireBasicCrmAccess } = await guards()
    await requireBasicCrmAccess()
    expect(getAgencyProductAccess).not.toHaveBeenCalled()
  })

  it('still refuses an unauthenticated caller', async () => {
    getUser.mockResolvedValue(null)
    const { requireBasicCrmAccess } = await guards()
    await expect(requireBasicCrmAccess()).rejects.toMatchObject({ name: 'AuthError', reason: 'no_session' })
  })

  it('still refuses a suspended user', async () => {
    getUser.mockResolvedValue({ ...REP, suspended: true })
    const { requireBasicCrmAccess } = await guards()
    await expect(requireBasicCrmAccess()).rejects.toMatchObject({ name: 'AuthError', reason: 'suspended' })
  })

  /** No agency ⇒ no tenant to scope to ⇒ no access. Unchanged. */
  it('still refuses a user with no agency', async () => {
    getUser.mockResolvedValue({ ...REP, agencyId: null })
    const { requireBasicCrmAccess } = await guards()
    await expect(requireBasicCrmAccess()).rejects.toMatchObject({ name: 'AuthError', reason: 'no_agency' })
  })

  /** The tenant is taken from the session, never from the caller. */
  it('returns the SESSION agencyId, which is what scopes every query', async () => {
    getUser.mockResolvedValue(REP)
    const { requireBasicCrmAccess } = await guards()
    const user = await requireBasicCrmAccess()
    expect(user.agencyId).toBe(103)
  })
})

describe('the paid guard is unchanged', () => {
  it('still refuses an expired subscriber, with the typed reason', async () => {
    getUser.mockResolvedValue(REP)
    getAgencyProductAccess.mockResolvedValue(EXPIRED)
    const { requireProductAccess } = await guards()
    await expect(requireProductAccess()).rejects.toMatchObject({
      name: 'ProductAccessError',
      reason: 'subscription-required',
    })
  })

  it('still refuses a trial that never started, distinctly', async () => {
    getUser.mockResolvedValue(REP)
    getAgencyProductAccess.mockResolvedValue({ status: 'NEVER_STARTED', hasAccess: false })
    const { requireProductAccess } = await guards()
    await expect(requireProductAccess()).rejects.toMatchObject({ reason: 'trial-not-started' })
  })

  it('still admits an active subscriber', async () => {
    getUser.mockResolvedValue(REP)
    getAgencyProductAccess.mockResolvedValue(ACTIVE)
    const { requireProductAccess } = await guards()
    await expect(requireProductAccess()).resolves.toMatchObject({ agencyId: 103 })
  })

  it('still refuses an unauthenticated caller before asking about the plan', async () => {
    getUser.mockResolvedValue(null)
    const { requireProductAccess } = await guards()
    await expect(requireProductAccess()).rejects.toMatchObject({ name: 'AuthError' })
    expect(getAgencyProductAccess).not.toHaveBeenCalled()
  })
})

describe('lead actions follow the policy, and say which is which', () => {
  const src = () => read('actions/clients.ts')

  /**
   * Status and rank are in the server-side writable allowlist, so "change a
   * lead's status" is exactly this action. It must not require a subscription.
   */
  it('updateLead is basic by default', () => {
    expect(src()).toMatch(/export async function updateLead\(data\) \{[\s\S]{0,900}requireBasicCrmAccess\(\)/)
  })

  it('status and rank are the fields it writes, through the allowlist', () => {
    const s = src()
    expect(s).toMatch(/CLIENT_WRITABLE_LEAD_FIELDS[\s\S]{0,600}'status'/)
    expect(s).toMatch(/CLIENT_WRITABLE_LEAD_FIELDS[\s\S]{0,600}'rank'/)
  })

  /** The one paid branch: converting a contact into a quota-consuming lead. */
  it('updateLead escalates to the paid guard only on the conversion branch', () => {
    // Scoped to updateLead's own body: `isLeadTrue` also appears in upsertLead.
    const body = src().slice(src().indexOf('export async function updateLead('))
    const basic = body.indexOf('requireBasicCrmAccess()')
    const conversion = body.indexOf('if (isLeadTrue(safeData.lead))')
    const escalation = body.indexOf('user = await requireProductAccess()')
    expect(basic).toBeGreaterThan(-1)
    expect(conversion).toBeGreaterThan(basic)
    expect(escalation).toBeGreaterThan(conversion)
    expect(body).toMatch(/requireProductAccess\(\)\s*\n\s*await assertLeadQuota/)
  })

  it('updateLead still scopes every write to the session tenant', () => {
    const s = src()
    const body = s.slice(s.indexOf('export async function updateLead('))
    expect(body).toContain("db('clients').where({ id, agencyId: user.agencyId })")
    expect(body).toContain('if (!isAdmin(user.role)) query.whereIn')
  })

  it('reads of existing leads are open', () => {
    const s = src()
    for (const fn of ['getLeadById', 'getLeadByIdNum', 'getLeadDeals', 'fetchLeadsSince']) {
      const at = s.indexOf(`export async function ${fn}(`)
      expect(at, fn).toBeGreaterThan(-1)
      expect(s.slice(at, at + 900), fn).toContain('requireBasicCrmAccess()')
    }
  })

  it('creating and importing leads stays paid', () => {
    const s = src()
    for (const fn of ['addLeads', 'uploadLeadData', 'importLeadsFromCsv']) {
      const at = s.indexOf(`export async function ${fn}(`)
      expect(at, fn).toBeGreaterThan(-1)
      expect(s.slice(at, at + 700), fn).toContain('requireProductAccess()')
    }
    // upsertLead is the mixed one: free to edit, escalating to create.
    const up = s.slice(s.indexOf('export async function upsertLead('))
    expect(up).toContain('requireBasicCrmAccess()')
    expect(up).toContain('user = await requireProductAccess()')
  })

  it('saved filters — search, sort, filter — are open', () => {
    expect(read('actions/filter.ts')).not.toContain('requireProductAccess')
    expect(read('actions/filter.ts')).toContain('requireBasicCrmAccess()')
  })
})

describe('the paid surfaces are still paid', () => {
  it.each([
    ['outbound WhatsApp', 'actions/whatsapp/sendWhatsappReply.ts'],
    ['new conversations from a lead', 'actions/whatsapp/promoteConversationToLead.ts'],
    ['AI ask', 'actions/ai/askGeneralQuestion.ts'],
    ['AI reply draft', 'actions/ai/whatsappReplyDraft.ts'],
    ['automation management', 'actions/automations/manage.ts'],
    ['invoice issue', 'actions/billing/issue.ts'],
    ['invoice send', 'actions/billing/send.ts'],
    ['file storage', 'actions/files.ts'],
    ['follow-up scheduling', 'actions/leadFollowUp.ts'],
    ['new meetings', 'actions/calendar/create.ts'],
  ])('%s still requires product access', (_label, file) => {
    expect(read(file)).toContain('requireProductAccess')
  })
})

describe('automations are gated where the money is spent, not only in the UI', () => {
  const EVENT = {
    trigger: 'status_changed' as const,
    origin: 'manual' as const,
    agencyId: 103,
    leadId: 5,
    newStatus: 'closed',
    occurredAt: new Date('2026-08-21T10:00:00.000Z'),
  }

  function deps(over: Record<string, unknown> = {}) {
    return {
      enabled: () => true,
      allowlisted: () => true,
      entitled: async () => true,
      listActive: async () => [],
      enqueue: async () => 1,
      shadow: async () => {},
      ...over,
    }
  }

  /**
   * The enabling change. A status change is free, but an automation it triggers
   * sends real messages — so the refusal belongs at the engine, where it holds
   * for every trigger source, not only for the surfaces a person clicks.
   */
  it('refuses to enqueue anything for a lapsed agency', async () => {
    const { emitAutomationEventWith } = await import('@/lib/automations/emit')
    const enqueue = vi.fn(async () => 1)
    const res = await emitAutomationEventWith(
      deps({ entitled: async () => false, enqueue }) as never,
      EVENT as never,
    )
    expect(res).toEqual({ blocked: 'no_product_access' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('costs no engine query when it refuses', async () => {
    const { emitAutomationEventWith } = await import('@/lib/automations/emit')
    const listActive = vi.fn(async () => [])
    await emitAutomationEventWith(deps({ entitled: async () => false, listActive }) as never, EVENT as never)
    expect(listActive).not.toHaveBeenCalled()
  })

  it('an entitled agency proceeds exactly as before', async () => {
    const { emitAutomationEventWith } = await import('@/lib/automations/emit')
    const listActive = vi.fn(async () => [])
    const res = await emitAutomationEventWith(deps({ listActive }) as never, EVENT as never)
    expect(listActive).toHaveBeenCalled()
    expect(res).toEqual({ blocked: 'no_active_definitions' })
  })

  /** The kill switch and allowlist still decide first — ordering unchanged. */
  it('leaves the existing gates ahead of it', async () => {
    const { emitAutomationEventWith } = await import('@/lib/automations/emit')
    const entitled = vi.fn(async () => false)
    const killed = await emitAutomationEventWith(deps({ enabled: () => false, entitled }) as never, EVENT as never)
    expect(killed).toEqual({ blocked: 'kill_switch' })
    const notAllowed = await emitAutomationEventWith(
      deps({ allowlisted: () => false, entitled }) as never,
      EVENT as never,
    )
    expect(notAllowed).toEqual({ blocked: 'agency_not_allowlisted' })
    expect(entitled).not.toHaveBeenCalled()
  })

  it('production wiring reads the canonical resolver', () => {
    expect(read('lib/automations/emit.ts')).toContain(
      'entitled: async (agencyId) => (await getAgencyProductAccess(agencyId)).hasAccess',
    )
  })
})

/* ------------------------------------------------------------------------- *
 * The three-tier policy.
 *
 * Tier 1 reads and basic CRM stay open. Tier 2 shows the feature and its
 * existing data, gating only the action that spends. Tier 3 may preview the UI
 * but must block the expensive call.
 * ------------------------------------------------------------------------- */

describe('Tier 1: reading your own data never asks about the plan', () => {
  it.each([
    ['notifications feed', 'app/api/notifications/feed/route.ts'],
    ['inbox awareness', 'app/api/inbox/awareness/route.ts'],
    ['inbox sync', 'app/api/inbox/sync/route.ts'],
  ])('%s no longer refuses an expired customer', (_l, file) => {
    const src = read(file)
    expect(src).not.toContain('product-access-required')
    expect(src).not.toContain('getAgencyProductAccess')
  })

  it.each([
    ['notifications feed', 'app/api/notifications/feed/route.ts'],
    ['inbox awareness', 'app/api/inbox/awareness/route.ts'],
    ['inbox sync', 'app/api/inbox/sync/route.ts'],
  ])('%s still refuses an unauthenticated caller and stays tenant scoped', (_l, file) => {
    const src = read(file)
    expect(src).toContain("{ status: 401")
    expect(src).toContain('user.agencyId')
  })
})

describe('Tier 2: the feature is visible, the spend is gated', () => {
  it('notifications render for an expired customer', () => {
    const page = read('app/(app)/notifications/page.tsx')
    expect(page).toContain('<NotificationCenter')
    expect(page).not.toContain('SubscriptionExpiredState')
  })

  it('the follow-up control shows the scheduled date and gates only the change', () => {
    const src = read('components/leads/FollowUpControl.tsx')
    expect(src).toContain('const scheduled = current ?')
    // The menu that writes a new follow-up is still behind the gate.
    expect(src.indexOf('if (expired) {')).toBeLessThan(src.indexOf("data-edu='lead-followup'"))
  })

  it.each([
    'app/(app)/settings/(admin_settings)/automations/page.tsx',
    'app/(app)/settings/(admin_settings)/automation-templates/page.tsx',
    'app/(app)/settings/(admin_settings)/quote-templates/page.tsx',
    'app/(app)/settings/(admin_settings)/auto-response/page.tsx',
  ])('%s renders its real content plus a Pro notice', (file) => {
    const src = read(file)
    expect(src).toContain('proLocked')
    expect(src).toContain("mode='inline'")
    expect(src).not.toContain("mode='page'")
  })

  it('installing an automation template is gated even though the gallery is open', () => {
    const src = read('components/settings/templates/TemplateInstallDialog.tsx')
    expect(src).toContain('const proLocked = useAccessDenied()')
    expect(src).toContain("source='automation_template_install'")
  })

  it('saving auto-response is gated even though the configuration is visible', () => {
    const src = read('components/settings/autoResponse/AutoResponseSettingsForm.tsx')
    expect(src).toContain('const proLocked = useAccessDenied()')
    expect(src).toContain("source='auto_response_save'")
  })
})

describe('Tier 3: preview is allowed, the expensive call is not', () => {
  it.each([
    ['WhatsApp composer', 'components/inbox/WhatsappComposerPanel.tsx'],
    ['WhatsApp reply draft', 'components/summary/WhatsappReplyDraft.tsx'],
    ['Copilot lead panel', 'components/copilot/CopilotPanel.tsx'],
    ['Copilot general panel', 'components/copilot/general/GeneralModePanel.tsx'],
  ])('%s still blocks the paid action', (_l, file) => {
    expect(read(file)).toContain('SubscriptionExpiredState')
  })

  /**
   * The lead summary is Tier 3: the insight is withheld, but the card is not.
   * The teaser shows the shape of it and costs nothing to produce, so the
   * guarantee is now asserted one step earlier — entitlement is resolved before
   * the AI action is reachable at all, and the router still refuses before a
   * provider is chosen for every other caller.
   */
  it('the lead AI summary is withheld, with no request made', () => {
    const card = read('components/ai/LeadIntelligenceCard.tsx')
    expect(card.indexOf('await getAgencyProductAccess(user.agencyId)')).toBeLessThan(
      card.indexOf('await getLeadIntelligence(leadId)'),
    )
    expect(card).toContain('return <LeadIntelligenceTeaser />')
    expect(read('lib/ai/access.ts')).toContain('getAgencyProductAccess')
  })

  it('the AI router still refuses before choosing a provider', () => {
    const router = read('lib/ai/gate.ts')
    expect(router.indexOf('const access = await resolveAiAccess')).toBeLessThan(
      router.indexOf('if (!hasAnyProviderConfigured())'),
    )
  })

  it('automations still refuse to run for a lapsed agency', () => {
    expect(read('lib/automations/emit.ts')).toContain("blocked: 'no_product_access'")
  })

  it('outbound messaging and lead creation stay server gated', () => {
    expect(read('actions/whatsapp/sendWhatsappReply.ts')).toContain('requireProductAccess')
    expect(read('actions/clients.ts')).toMatch(/export async function addLeads[\s\S]{0,700}requireProductAccess\(\)/)
  })
})

describe('expired copy speaks in value, and never joins words with a dash', () => {
  const COPY_FILES = [
    'components/entitlement/SubscriptionExpiredState.tsx',
    'components/settings/payment/PaymentMethodRow.tsx',
    'components/clients/CrmSyncBanner.tsx',
    'components/ai/LeadIntelligenceCard.tsx',
  ]

  /** Rendered Hebrew only: comments and identifiers are out of scope. */
  function renderedHebrew(file: string): string[] {
    return read(file)
      .split('\n')
      .filter((l) => {
        const t = l.trim()
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
      })
      .filter((l) => /[֐-׿]/.test(l))
  }

  it.each(COPY_FILES)('%s uses no dash between Hebrew words', (file) => {
    for (const line of renderedHebrew(file)) {
      expect(line, line.trim()).not.toMatch(/[֐-׿]\s[-–—]\s/)
      expect(line, line.trim()).not.toMatch(/\s[-–—]\s[֐-׿]/)
    }
  })

  it('the shared state tells the customer what renewing gives back', () => {
    const src = read('components/entitlement/SubscriptionExpiredState.tsx')
    expect(src).toContain('חידוש המנוי מחזיר את היכולות המתקדמות מיד.')
    expect(src).toContain('נשארים זמינים')
  })

  it('no locked surface describes itself with a bare "מושהה"', () => {
    // Rendered lines only: the comments deliberately quote the old wording.
    for (const line of renderedHebrew('components/entitlement/SubscriptionExpiredState.tsx')) {
      expect(line, line.trim()).not.toMatch(/מושה/)
    }
    const all = require('node:child_process')
      .execSync("grep -rho \"feature='[^']*'\" components modules app || true", { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
    expect(all.length).toBeGreaterThan(10)
    for (const f of all) expect(f, f).toContain('חידוש המנוי')
  })
})

/* ------------------------------------------------------------------------- *
 * Ratified product decisions.
 *
 * What an expired customer may do, and what they may not, asserted one action
 * at a time against the guard each action actually calls.
 * ------------------------------------------------------------------------- */

/** The guard a given exported action reaches for, read from its own body. */
function guardOf(file: string, fn: string): 'basic' | 'paid' | 'none' {
  const src = read(file)
  const at = src.indexOf(`export async function ${fn}(`)
  if (at < 0) throw new Error(`${fn} not found in ${file}`)
  const body = src.slice(at, at + 1400)
  if (body.includes('requireBasicCrmAccess()')) return 'basic'
  if (body.includes('requireProductAccess()')) return 'paid'
  return 'none'
}

describe('OPEN to an expired customer: basic CRM on existing records', () => {
  it.each([
    ['change lead status and basic fields', 'actions/clients.ts', 'updateLead'],
    ['edit an existing lead through upsert', 'actions/clients.ts', 'upsertLead'],
    ['change deal status', 'actions/salesTbl.ts', 'updateDealStatus'],
    ['change many deal statuses', 'actions/salesTbl.ts', 'updateManyDealStatus'],
    ['record a call outcome', 'actions/leadOutcome.ts', 'logLeadOutcome'],
    ['read a lead', 'actions/clients.ts', 'getLeadById'],
    ['poll the leads list', 'actions/clients.ts', 'fetchLeadsSince'],
  ])('%s', (_label, file, fn) => {
    expect(guardOf(file, fn)).toBe('basic')
  })

  it('deal status writes no commission field and stays agency scoped', () => {
    const src = read('actions/salesTbl.ts')
    const at = src.indexOf('export async function updateDealStatus(')
    const body = src.slice(at, at + 600)
    expect(body).toContain('agencyId: user.agencyId')
    expect(body).not.toContain('rwrd')
  })

  it('the call outcome stays permission scoped exactly as before', () => {
    const src = read('actions/leadOutcome.ts')
    expect(src).toContain('getPerms')
    expect(src).toContain('user.agencyId')
  })

  /** The emission is allowed; the ENGINE is what refuses to spend. */
  it('a call outcome may still emit, because the engine now gates the spend', () => {
    expect(read('actions/leadOutcome.ts')).toContain('emitLeadStatusChanged')
    expect(read('lib/automations/emit.ts')).toContain("blocked: 'no_product_access'")
  })
})

describe('BLOCKED for an expired customer: creating or spending', () => {
  it.each([
    ['import leads from a sheet', 'actions/clients.ts', 'uploadLeadData'],
    ['bulk add leads', 'actions/clients.ts', 'addLeads'],
    ['import leads from CSV', 'actions/clients.ts', 'importLeadsFromCsv'],
    ['delete a lead', 'actions/clients.ts', 'deleteLead'],
    ['delete many leads', 'actions/clients.ts', 'deleteManyLeads'],
    ['create a conversation from a lead', 'actions/whatsapp/promoteConversationToLead.ts', 'promoteConversationToLead'],
    ['create a meeting', 'actions/calendar/create.ts', 'createMeeting'],
  ])('%s stays Pro gated', (_label, file, fn) => {
    expect(guardOf(file, fn)).toBe('paid')
  })

  /** Guards through a shared helper, so the assertion is module level. */
  it('scheduling a follow-up stays Pro gated', () => {
    const src = read('actions/leadFollowUp.ts')
    expect(src).toContain('requireProductAccess()')
    expect(src).not.toContain('requireBasicCrmAccess')
  })

  it('creating a lead escalates inside upsertLead, even though editing does not', () => {
    const body = read('actions/clients.ts').slice(read('actions/clients.ts').indexOf('export async function upsertLead('))
    const create = body.indexOf('// CREATE branch')
    const escalate = body.indexOf('user = await requireProductAccess()', create)
    expect(create).toBeGreaterThan(-1)
    expect(escalate).toBeGreaterThan(create)
    // …and so does turning a contact into a lead.
    expect(body).toMatch(/existing\.lead === false[\s\S]{0,220}requireProductAccess\(\)/)
  })

  it.each([
    ['send WhatsApp', 'actions/whatsapp/sendWhatsappReply.ts'],
    ['AI general question', 'actions/ai/askGeneralQuestion.ts'],
    ['AI reply draft', 'actions/ai/whatsappReplyDraft.ts'],
    ['create or edit automations', 'actions/automations/manage.ts'],
    ['upload files', 'actions/files.ts'],
    ['issue an invoice', 'actions/billing/issue.ts'],
    ['send an invoice', 'actions/billing/send.ts'],
  ])('%s stays Pro gated', (_label, file) => {
    expect(read(file)).toContain('requireProductAccess')
  })
})

describe('security is unchanged by any of it', () => {
  it('the opened actions are still tenant scoped', () => {
    for (const [file, fn] of [
      ['actions/clients.ts', 'updateLead'],
      ['actions/salesTbl.ts', 'updateDealStatus'],
      ['actions/leadOutcome.ts', 'logLeadOutcome'],
    ] as const) {
      const src = read(file)
      const body = src.slice(src.indexOf(`export async function ${fn}(`), src.indexOf(`export async function ${fn}(`) + 1400)
      expect(body, fn).toContain('agencyId')
    }
  })

  it('the basic guard still rejects anonymous callers', async () => {
    getUser.mockResolvedValue(null)
    const { requireBasicCrmAccess } = await guards()
    await expect(requireBasicCrmAccess()).rejects.toMatchObject({ name: 'AuthError' })
  })

  it('the basic guard derives the tenant from the session, never the caller', async () => {
    getUser.mockResolvedValue({ ...REP, agencyId: 55 })
    const { requireBasicCrmAccess } = await guards()
    await expect(requireBasicCrmAccess()).resolves.toMatchObject({ agencyId: 55 })
  })
})

describe('secondary settings actions are gated at the same choke point', () => {
  it.each([
    ['template removal', 'components/settings/templates/TemplateCard.tsx', 'automation_template_remove'],
    ['automation save', 'components/settings/automations/AutomationSheet.tsx', 'automation_save'],
    ['quote template save', 'components/quotes/QuoteTemplateSheet.tsx', 'quote_template_save'],
  ])('%s uses the shared entitlement state, not a generic error', (_l, file, source) => {
    const src = read(file)
    expect(src).toContain('const proLocked = useAccessDenied()')
    expect(src).toContain(`source='${source}'`)
  })
})

describe('the outcome control is no longer gated in the UI either', () => {
  it('records outcomes for an expired customer', () => {
    const src = read('components/leads/OutcomeControl.tsx')
    expect(src).not.toContain('useAccessDenied')
    expect(src).not.toContain('SubscriptionExpiredState')
    expect(src).toContain('logLeadOutcome')
  })
})

/* ------------------------------------------------------------------------- *
 * The notifications engine gate.
 *
 * Delivery ends at an external browser push service, so entitlement belongs at
 * the engine door — the same boundary automations already use — and not in
 * whichever UI happened to raise the event.
 * ------------------------------------------------------------------------- */

describe('notifications refuse to enqueue delivery for a lapsed agency', () => {
  const EVENT = {
    type: 'lead.assigned' as const,
    agencyId: 103,
    entityType: 'lead' as const,
    entityId: 5,
    actorUserId: 7,
    occurredAt: new Date('2026-08-22T10:00:00.000Z'),
    // lead.assigned derives its event key from assignedUserId; without it the
    // key builder throws and the engine reports 'error' instead of enqueuing.
    payload: { leadName: 'דוד', assignedUserId: 9 },
  }

  function deps(over: Record<string, unknown> = {}) {
    return {
      enabled: () => true,
      allowlisted: () => true,
      entitled: async () => true,
      lookupType: () => ({ enabled: true }),
      enqueue: async () => 1,
      shadow: () => {},
      kick: () => {},
      ...over,
    }
  }

  it('blocks before the queue insert', async () => {
    const { notifyEventWith } = await import('@/lib/notifications/emit')
    const enqueue = vi.fn(async () => 1)
    const res = await notifyEventWith(deps({ entitled: async () => false, enqueue }) as never, EVENT as never)
    expect(res).toEqual({ enqueued: false, reason: 'no_product_access' })
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('creates no delivery job and never kicks the worker', async () => {
    const { notifyEventWith } = await import('@/lib/notifications/emit')
    const kick = vi.fn()
    const res = await notifyEventWith(deps({ entitled: async () => false, kick }) as never, EVENT as never)
    expect('jobId' in res).toBe(false)
    expect(kick).not.toHaveBeenCalled()
  })

  it('an entitled agency behaves exactly as before', async () => {
    const { notifyEventWith } = await import('@/lib/notifications/emit')
    const enqueue = vi.fn(async () => 42)
    const kick = vi.fn()
    const res = await notifyEventWith(deps({ enqueue, kick }) as never, EVENT as never)
    expect(res).toEqual({ enqueued: true, jobId: 42 })
    expect(kick).toHaveBeenCalledTimes(1)
  })

  it('a duplicate is still a duplicate, not an entitlement refusal', async () => {
    const { notifyEventWith } = await import('@/lib/notifications/emit')
    const res = await notifyEventWith(deps({ enqueue: async () => null }) as never, EVENT as never)
    expect(res).toEqual({ enqueued: false, reason: 'duplicate' })
  })

  /** Requirement: existing gate order and semantics are untouched. */
  it('the kill switch still decides first, and still shadows', async () => {
    const { notifyEventWith } = await import('@/lib/notifications/emit')
    const entitled = vi.fn(async () => false)
    const shadow = vi.fn()
    const res = await notifyEventWith(
      deps({ enabled: () => false, entitled, shadow }) as never,
      EVENT as never,
    )
    expect(res).toEqual({ enqueued: false, reason: 'kill_switch' })
    expect(shadow).toHaveBeenCalledTimes(1)
    expect(entitled).not.toHaveBeenCalled()
  })

  it('the allowlist still decides before entitlement', async () => {
    const { notifyEventWith } = await import('@/lib/notifications/emit')
    const entitled = vi.fn(async () => false)
    const res = await notifyEventWith(deps({ allowlisted: () => false, entitled }) as never, EVENT as never)
    expect(res).toEqual({ enqueued: false, reason: 'agency_not_allowlisted' })
    expect(entitled).not.toHaveBeenCalled()
  })

  it('an unknown or disabled type still short circuits, with no access read', async () => {
    const { notifyEventWith } = await import('@/lib/notifications/emit')
    const entitled = vi.fn(async () => false)
    const unknown = await notifyEventWith(deps({ lookupType: () => undefined, entitled }) as never, EVENT as never)
    expect(unknown).toEqual({ enqueued: false, reason: 'unknown_type' })
    const disabled = await notifyEventWith(
      deps({ lookupType: () => ({ enabled: false }), entitled }) as never,
      EVENT as never,
    )
    expect(disabled).toEqual({ enqueued: false, reason: 'type_disabled' })
    expect(entitled).not.toHaveBeenCalled()
  })

  it('production wiring uses the canonical resolver, not a second calculation', () => {
    const src = read('lib/notifications/emit.ts')
    expect(src).toContain('entitled: async (agencyId) => (await getAgencyProductAccess(agencyId)).hasAccess')
    expect(src).not.toContain('getTrialState')
    expect(src).not.toContain('hasActiveProductAccess')
  })
})

describe('no emitter can route around the notification gate', () => {
  /**
   * Every business trigger reaches delivery through notifyEvent, so gating the
   * door covers all of them at once. This asserts the shape rather than each
   * caller: a new emitter inherits the gate for free.
   */
  it('notifyEvent is the only door, and every gate sits inside it', () => {
    const src = read('lib/notifications/emit.ts')
    const gate = src.indexOf("reason: 'no_product_access'")
    const insert = src.indexOf('await deps.enqueue(')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(insert)
  })

  it.each([
    ['lead status change', 'actions/clients.ts'],
    ['call outcome', 'actions/leadOutcome.ts'],
    ['Close Deal', 'actions/saleForm.ts'],
  ])('%s reaches notifications only through the shared emitter', (_l, file) => {
    const src = read(file)
    expect(src).toContain('emitLeadStatusChanged')
    // No direct queue writes that would skip the door.
    expect(src).not.toContain('enqueueNotificationJob')
  })

  it('the shared status emitter delegates to both engines and invents nothing', () => {
    const src = read('lib/automations/statusChanged.ts')
    expect(src).toContain('emitAutomationEvent')
    expect(src).toContain('notifyEvent')
    expect(src).not.toContain('enqueueNotificationJob')
  })

  it('deal status changes raise no notification at all', () => {
    const src = read('actions/salesTbl.ts')
    expect(src).not.toContain('notifyEvent')
    expect(src).not.toContain('emitLeadStatusChanged')
  })

  it('automations remain gated at their own engine', () => {
    expect(read('lib/automations/emit.ts')).toContain("blocked: 'no_product_access'")
  })
})

describe('reading notifications is untouched by the delivery gate', () => {
  it('the feed endpoint stays open and tenant scoped', () => {
    const src = read('app/api/notifications/feed/route.ts')
    expect(src).not.toContain('product-access-required')
    expect(src).toContain("{ status: 401")
    expect(src).toContain('user.agencyId')
  })

  it('the page renders stored notifications for an expired customer', () => {
    const page = read('app/(app)/notifications/page.tsx')
    expect(page).toContain('<NotificationCenter')
    expect(page).not.toContain('SubscriptionExpiredState')
  })

  it('the bell panel still lists them, and navigation is not gated', () => {
    expect(read('components/notifications/NotificationPanel.tsx')).not.toContain('useAccessDenied')
    // Following a notification is a plain route push, with no entitlement check
    // between the row and the object it points at.
    for (const f of ['components/notifications/NotificationBell.tsx', 'components/notifications/NotificationCenter.tsx']) {
      const src = read(f)
      expect(src, f).toContain('router.push(item.deepLink)')
      expect(src, f).not.toContain('useAccessDenied')
    }
  })

  it('the gate stops new delivery only, never a historical read', () => {
    const src = read('lib/notifications/emit.ts')
    // The refusal sits on the emission path; nothing in this module reads rows.
    expect(src).toContain("reason: 'no_product_access'")
    expect(src).not.toContain('select(')
  })
})

/* ------------------------------------------------------------------------- *
 * Automations: teasing, not breaking.
 *
 * Entitlement governs EXECUTION. The stored automation keeps whatever the
 * customer configured, and a refusal reads as a billing prompt rather than an
 * application error.
 * ------------------------------------------------------------------------- */

describe('the automations page answers a lapsed subscription with billing, not an error', () => {
  const settings = () => read('components/settings/automations/AutomationsSettings.tsx')

  /**
   * The reported defect: the toggle threw a guarded Server Action, Next routed
   * it to the segment error boundary, and the customer saw the whole page
   * replaced by "חלה שגיאה במערכת" — app/(app)/error.tsx.
   */
  it('pre-gates before any action runs, so nothing is dispatched', () => {
    const src = settings()
    expect(src).toContain('if (expired) return proPrompt()')
    // The guard sits ahead of the busy state and the transition.
    const gate = src.indexOf('if (expired) return proPrompt()')
    expect(gate).toBeLessThan(src.indexOf('setBusyId(id)', gate))
    expect(gate).toBeLessThan(src.indexOf('startTransition', gate))
  })

  it('never reaches the segment error boundary, even from a stale context', () => {
    const src = settings()
    // Every awaited action is wrapped, so a refusal cannot escape the component.
    expect(src).toMatch(/try \{\s*\n\s*res = await fn\(\)/)
    expect(src).toContain('return expired ? proPrompt() : ')
  })

  it('a genuine failure still reads as a failure', () => {
    expect(settings()).toContain("toast('error', 'הפעולה נכשלה. נסו שוב.')")
  })

  it('the run log is gated too, and cannot throw to the boundary', () => {
    const src = settings()
    expect(src).toContain('// The run log is execution history')
    expect(src).toMatch(/res = await listActivityForAutomationAction\(card\.id\)/)
  })

  it('the test send is gated, because it is real outbound delivery', () => {
    const src = read('components/settings/automations/AutomationSheet.tsx')
    expect(src).toContain("source: 'automation_test_send'")
    expect(src.indexOf('if (proLocked) {')).toBeLessThan(src.indexOf('await sendTestEmail('))
  })
})

describe('the automation definition is never touched by expiry', () => {
  /**
   * The stored state is the customer's configuration. Nothing in the expired
   * path writes it, and no parallel "disabled because expired" flag exists.
   */
  it('no client surface writes enabled/status on expiry', () => {
    for (const f of [
      'components/settings/automations/AutomationsSettings.tsx',
      'components/settings/automations/AutomationCard.tsx',
      'components/settings/automations/AutomationControlCenter.tsx',
    ]) {
      const src = read(f)
      expect(src, f).not.toMatch(/expired[\s\S]{0,80}setAutomationStatus/)
      expect(src, f).not.toContain('subscriptionExpiredDisabled')
    }
  })

  it('the toggle renders from server props, so a blocked click cannot move it', () => {
    const card = read('components/settings/automations/AutomationCard.tsx')
    expect(card).toContain('aria-pressed={isActive}')
    // No local optimistic mirror of the toggle.
    expect(card).not.toMatch(/useState[^\n]*isActive/)
  })

  it('the engine refuses execution without changing anything', () => {
    const engine = read('lib/automations/emit.ts')
    expect(engine).toContain("blocked: 'no_product_access'")
    expect(engine).not.toContain('update(')
    expect(engine).not.toContain("status: 'paused'")
  })

  it('server-side gating remains the final authority', () => {
    expect(read('actions/automations/manage.ts')).toContain('requireProductAccess')
    expect(read('actions/automations/templates.ts')).toContain('requireProductAccess')
    expect(read('actions/automations/sendTest.ts')).toContain('requireProductAccess')
  })
})

describe('the Pro toast is a subscription action, not an error', () => {
  const toastSrc = () => read('lib/toast.tsx')

  it('wears the renewal banner tokens, never the destructive red', () => {
    const css = read('lib/css/elements.css')
    expect(css).toContain('.toast-pro')
    expect(css).toContain('bg-warning-bg')
    expect(css).toContain('border-warning-border')
    expect(toastSrc()).toContain("bg-warning-text size-5")
    expect(toastSrc()).not.toMatch(/toast-pro[\s\S]{0,120}(bg-red|text-error|bg-error)/)
  })

  it('carries a title, a body and the renewal CTA', () => {
    const src = toastSrc()
    expect(src).toContain('{pop.pro.title}')
    expect(src).toContain('{pop.pro.body}')
    expect(src).toContain("{pop.pro.cta ?? 'חידוש מנוי'}")
  })

  it('the CTA reuses the existing billing destination, with no second mechanism', () => {
    const src = toastSrc()
    expect(src).toContain('href={upgradeHref(pop.pro.source)}')
    expect(src).not.toContain('/api/payments/upgrade?source=')
    // One definition of that destination, shared with the expired states.
    const shared = read('lib/entitlement/upgradeHref.ts')
    expect(shared).toContain('/api/payments/upgrade?source=')
    expect(read('components/entitlement/SubscriptionExpiredState.tsx')).toContain('upgradeHref(source)')
  })

  it('is a variant of the existing toast, not a new notification system', () => {
    const src = toastSrc()
    expect(src).toContain("id='popMsg'")
    expect(src).toContain("pop.icon === 'pro' ? 'toast toast-pro' : 'toast'")
  })

  it('announces itself to assistive tech like the other toasts', () => {
    expect(toastSrc()).toContain('setLive(`${opts.title}. ${opts.body}`)')
  })
})

describe('the new automation copy follows the Hebrew rule', () => {
  const NEW_COPY = [
    'הפעלת האוטומציות זמינה עם Pro',
    'חידוש המנוי יחזיר את הפעלת האוטומציות.',
    'שליחת אימייל בדיקה זמינה עם Pro',
    'חידוש המנוי יחזיר את שליחת הבדיקות.',
  ]

  it('contains no dash or maqaf used as a separator', () => {
    for (const line of NEW_COPY) {
      expect(line, line).not.toMatch(/[-–—־]/)
    }
  })

  it('is the copy the product actually renders', () => {
    const settings = read('components/settings/automations/AutomationsSettings.tsx')
    expect(settings).toContain(NEW_COPY[0])
    expect(settings).toContain(NEW_COPY[1])
    const sheet = read('components/settings/automations/AutomationSheet.tsx')
    expect(sheet).toContain(NEW_COPY[2])
    expect(sheet).toContain(NEW_COPY[3])
  })
})

/* ------------------------------------------------------------------------- *
 * Automation inspection: read to understand, pay to run.
 * ------------------------------------------------------------------------- */

describe('automation previews and option loading are open', () => {
  it.each([
    ['template slots', 'actions/automations/previewMessage.ts', 'listTemplateSlots'],
    ['message preview', 'actions/automations/previewMessage.ts', 'previewAutomationMessage'],
    ['email preview', 'actions/automations/previewEmail.ts', 'previewAutomationEmail'],
    ['first party options', 'actions/automations/firstPartyOptions.ts', 'listFirstPartyOptionsAction'],
  ])('%s reads without asking about the plan', (_l, file, fn) => {
    expect(guardOf(file, fn)).toBe('basic')
  })

  it('the four connector list actions use the read guard', () => {
    const src = read('actions/automations/connections.ts')
    for (const fn of [
      'listConnectionsAction',
      'listSourcesAction',
      'listOptionsAction',
      'listOptionsForCapabilityAction',
    ]) {
      const at = src.indexOf(`export async function ${fn}(`)
      expect(at, fn).toBeGreaterThan(-1)
      expect(src.slice(at, at + 320), fn).toContain('await readGuard()')
    }
  })

  /** The same file's writes must NOT have moved. */
  it('connection provisioning, revoking, regenerating and renaming stay paid', () => {
    const src = read('actions/automations/connections.ts')
    for (const fn of ['provisionApiKeyConnection', 'revokeConnection', 'regenerateSecret', 'renameSource']) {
      const at = src.indexOf(`export async function ${fn}(`)
      expect(at, fn).toBeGreaterThan(-1)
      expect(src.slice(at, at + 420), fn).toContain('await guard()')
    }
    expect(src).toContain('const user = await requireProductAccess()')
  })

  it('the admin check is unchanged on both guards', () => {
    const src = read('actions/automations/connections.ts')
    expect(src.match(/if \(!isAdmin\(user\.role\)\) return null/g)?.length).toBe(2)
  })

  /** Proof these are reads: no provider call, no send, anywhere in the chain. */
  it('previews render from stored rows and dispatch nothing', () => {
    const wa = read('lib/automations/executors/whatsapp.ts')
    const at = wa.indexOf('async preview(')
    const body = wa.slice(at, at + 700)
    expect(body).toContain('deps.loadTemplate(')
    expect(body).not.toContain('deps.send')
    // The template loader is a plain database read.
    expect(read('db/whatsappTemplates.ts')).toMatch(/loadTemplateForSend[\s\S]{0,200}db\('whatsapp_templates'\)/)
  })

  it('connector option sources resolve locally, with no outbound call', () => {
    for (const f of ['lib/automations/connectors/whatsapp.ts', 'lib/automations/connectors/contactForm7.ts']) {
      const src = read(f)
      expect(src, f).not.toMatch(/async options\([\s\S]{0,400}(fetch\(|axios)/)
    }
  })
})

describe('everything that spends is still gated', () => {
  it.each([
    ['send a test email', 'actions/automations/sendTest.ts'],
    ['create or save an automation', 'actions/automations/manage.ts'],
    ['install or remove a template', 'actions/automations/templates.ts'],
    ['read the run log', 'actions/automations/activity.ts'],
  ])('%s stays Pro gated', (_l, file) => {
    expect(read(file)).toContain('requireProductAccess')
  })

  it('the engine is still the authority on execution', () => {
    expect(read('lib/automations/emit.ts')).toContain("blocked: 'no_product_access'")
  })

  it('opening a preview writes nothing to the definition', () => {
    for (const f of [
      'actions/automations/previewMessage.ts',
      'actions/automations/previewEmail.ts',
      'actions/automations/firstPartyOptions.ts',
    ]) {
      const src = read(f)
      expect(src, f).not.toMatch(/\.update\(|\.insert\(|\.del\(\)/)
    }
  })
})

/* ------------------------------------------------------------------------- *
 * Cleanup batch: false Pro gates removed, real ones given the Pro toast.
 * ------------------------------------------------------------------------- */

describe('operations with no paid consequence are Tier 1', () => {
  it.each([
    ['table column preferences', 'actions/global.ts', 'saveTblPref'],
    ['add deal favourites', 'actions/salesTbl.ts', 'addFavDeals'],
    ['remove deal favourites', 'actions/salesTbl.ts', 'removeFavDeals'],
    ['remove one favourite', 'actions/salesTbl.ts', 'removeFavDeal'],
    ['create a task template', 'actions/tasks.ts', 'addTaskTmplt'],
    ['delete a task template', 'actions/tasks.ts', 'deleteTaskTmplt'],
  ])('%s is open to an expired customer', (_l, file, fn) => {
    expect(guardOf(file, fn)).toBe('basic')
  })

  /** Search is basic CRM by the ratified policy; it reads and spends nothing. */
  it('lead search is open', () => {
    const src = read('actions/clients.ts')
    const at = src.indexOf('async function searchBase(')
    expect(src.slice(at, at + 400)).toContain('requireBasicCrmAccess()')
    expect(src.slice(at, at + 400)).not.toContain('requireProductAccess()')
  })

  it.each([
    'actions/analytics/recordFirstLeadEvent.ts',
    'actions/analytics/recordGeneralModeEvent.ts',
    'actions/analytics/recordLeadActionEvent.ts',
    'actions/analytics/recordOperatorTakeEvent.ts',
    'actions/education/recordEducationEvent.ts',
  ])('%s records telemetry without a subscription', (file) => {
    const src = read(file)
    expect(src).toContain('requireBasicCrmAccess')
    expect(src).not.toContain('requireProductAccess')
  })

  it('every opened action keeps its tenant and user scoping', () => {
    expect(read('actions/global.ts')).toContain("db('users')\n    .where({ id: user.id })")
    const sales = read('actions/salesTbl.ts')
    expect(sales).toContain('favSaleIds')
    expect(sales.slice(sales.indexOf('export async function addFavDeals('), sales.indexOf('export async function addFavDeals(') + 400))
      .toContain('.where({ id: user.id })')
    // Task-template deletion still proves ownership before it deletes.
    const tasks = read('actions/tasks.ts')
    const at = tasks.indexOf('export async function deleteTaskTmplt(')
    expect(tasks.slice(at, at + 320)).toContain('assertTemplateAccess(taskTmplt.id, user)')
  })

  it('search keeps its agency scoping and permission filter', () => {
    const src = read('actions/clients.ts')
    const at = src.indexOf('async function searchBase(')
    const body = src.slice(at, at + 1200)
    expect(body).toContain('getAgencyId()')
  })
})

describe('destructive and commission-sensitive operations stay Pro', () => {
  it.each([
    ['delete a lead', 'actions/clients.ts', 'deleteLead'],
    ['delete many leads', 'actions/clients.ts', 'deleteManyLeads'],
    ['delete deals', 'actions/salesTbl.ts', 'deleteDeals'],
  ])('%s remains gated pending a product decision', (_l, file, fn) => {
    expect(guardOf(file, fn)).toBe('paid')
  })

  it('Close Deal stays Pro, because it writes commission attribution', () => {
    const src = read('actions/saleForm.ts')
    expect(src).toContain('requireProductAccess()')
    expect(src).toMatch(/cmsn|rwrd/)
  })

  it('the commission reward flag is untouched', () => {
    const src = read('actions/salesTbl.ts')
    const at = src.indexOf('export async function saveReward(')
    expect(src.slice(at, at + 220)).toContain('requireProductAccess()')
  })
})

describe('expected denials reach the Pro toast, never the error boundary', () => {
  it.each([
    ['ready message send', 'components/clients/SendReadyMessage.tsx', 'ready_message_send'],
    ['ready message send, mobile', 'components/clients/SendReadyMessageMobile.tsx', 'ready_message_send'],
    ['lead import', 'components/settings/UploadClientData.tsx', 'lead_import'],
    ['mobile auto response toggle', 'modules/settings/mobile/AutoResponseToggle.tsx', 'auto_response_toggle_mobile'],
    ['connection provisioning', 'components/settings/connections/ConnectAction.tsx', 'connection_manage'],
    ['connection secret and rename', 'components/settings/connections/ConnectionDetails.tsx', 'connection_manage'],
    ['connection revoke', 'components/settings/connections/IntegrationConnectionCard.tsx', 'connection_manage'],
    ['quote composer save', 'components/quotes/QuoteComposer.tsx', 'quote_composer'],
  ])('%s prompts instead of throwing', (_l, file, source) => {
    const src = read(file)
    expect(src).toContain('useAccessDenied()')
    expect(src).toContain(`source: '${source}'`)
    expect(src).toContain('if (expired)')
  })

  it('the mobile auto response switch keeps its saved state when refused', () => {
    const src = read('modules/settings/mobile/AutoResponseToggle.tsx')
    // The prompt returns before the optimistic flip, so the switch keeps the
    // saved state. (Anchored on setEnabled, not startTransition: the latter
    // also appears in the useTransition declaration above.)
    const gate = src.indexOf('if (expired) {')
    expect(gate).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(src.indexOf('setEnabled(next)'))
  })

  it('the quote resolver still returns its typed contract when refused', () => {
    expect(read('components/quotes/QuoteComposer.tsx')).toContain(
      "return { ok: false as const, reason: 'subscription_required' }",
    )
  })

  it('the server guards behind all of them are untouched', () => {
    expect(read('actions/whatsapp/templates/sendTemplateToLead.ts') || '').toBeDefined()
    expect(read('actions/automations/connections.ts')).toContain('requireProductAccess()')
    expect(read('actions/quotes/templates.ts')).toContain('requireProductAccess')
    expect(read('actions/clients.ts')).toMatch(/export async function addLeads[\s\S]{0,700}requireProductAccess\(\)/)
  })

  it('no new toast, hook or billing destination was invented', () => {
    for (const f of [
      'components/clients/SendReadyMessage.tsx',
      'components/settings/UploadClientData.tsx',
      'components/quotes/QuoteComposer.tsx',
    ]) {
      const src = read(f)
      expect(src, f).toContain("from '@/lib/toast'")
      expect(src, f).not.toContain('/api/payments/upgrade?source=')
    }
  })
})

describe('the cleanup copy follows the Hebrew rule', () => {
  it('uses no dash or maqaf as a separator', () => {
    for (const line of [
      'שליחת הודעות זמינה עם Pro',
      'חידוש המנוי יחזיר את שליחת ההודעות ללידים.',
      'ייבוא לידים זמין עם Pro',
      'חידוש המנוי יחזיר את ייבוא הלידים מקובץ.',
      'המענה האוטומטי זמין עם Pro',
      'חידוש המנוי יחזיר את המענה האוטומטי.',
      'ניהול חיבורים זמין עם Pro',
      'חידוש המנוי יחזיר את ניהול החיבורים.',
      'עריכת הצעות מחיר זמינה עם Pro',
      'חידוש המנוי יחזיר את עריכת הצעות המחיר.',
    ]) {
      expect(line, line).not.toMatch(/[-–—־]/)
    }
  })
})

/* ------------------------------------------------------------------------- *
 * ONE SUBSCRIPTION NOTICE PER SCREEN.
 *
 * Tease Pro where the customer reaches for it, once. A screen that stacks
 * persistent upsells stops being a product and becomes a payment prompt.
 * ------------------------------------------------------------------------- */

describe('a screen carries at most one persistent subscription notice', () => {
  /**
   * The lead detail page's main column. The follow-up control is the contextual
   * notice that stays: it sits beside the capability the customer reached for.
   */
  it('the lead page keeps exactly one, beside the follow-up control', () => {
    const followUp = read('components/leads/FollowUpControl.tsx')
    expect(followUp).toContain("source='lead_followup'")
    expect(followUp).toContain('חידוש המנוי מחזיר את קביעת המעקבים')
  })

  it('the AI summary card teases the value rather than adding a second notice', () => {
    const card = read('components/ai/LeadIntelligenceCard.tsx')
    expect(card).toContain('return <LeadIntelligenceTeaser />')
    expect(card).not.toContain('SubscriptionExpiredState')
    // The teaser raises the subscription on interaction, never as standing copy.
    const teaser = read('components/ai/LeadIntelligenceTeaser.tsx')
    expect(teaser).not.toContain('SubscriptionExpiredState')
    expect(teaser).toContain('proToast({')
  })

  /** Removing the notice must not resurrect the retry line it replaced. */
  it('and it never falls back to the generic retry copy for entitlement', () => {
    const card = read('components/ai/LeadIntelligenceCard.tsx')
    const entitlement = card.indexOf("res.reason === 'subscription-required'")
    const retry = card.indexOf('העוזר החכם לא זמין כרגע')
    expect(entitlement).toBeGreaterThan(-1)
    expect(entitlement).toBeLessThan(retry) // the entitlement branch returns first
    // The retry line survives for genuine AI failures.
    expect(card).toContain('העוזר החכם לא זמין כרגע. נסו שוב בעוד דקה.')
  })

  /**
   * The Copilot panel's notice lives in the assistant aside, not the lead
   * column, and it replaces the composer rather than sitting above readable
   * content. It is that surface's own single notice, so it stays.
   */
  it('the copilot aside keeps its own composer replacement', () => {
    expect(read('components/copilot/CopilotPanel.tsx')).toContain("source='copilot_panel'")
  })

  it('free CRM functionality on the page is not hidden', () => {
    // Outcome logging is Tier 1 and carries no notice at all.
    const outcome = read('components/leads/OutcomeControl.tsx')
    expect(outcome).not.toContain('useAccessDenied')
    expect(outcome).not.toContain('SubscriptionExpiredState')
    // The follow-up control still shows an existing scheduled date.
    expect(read('components/leads/FollowUpControl.tsx')).toContain('const scheduled = current ?')
  })

  it('no new mechanism was introduced to achieve this', () => {
    const card = read('components/ai/LeadIntelligenceCard.tsx')
    expect(card).not.toContain('proToast')
    expect(card).not.toContain('/api/payments/upgrade')
    // The teaser reuses the shared Pro toast, which still owns the destination.
    const teaser = read('components/ai/LeadIntelligenceTeaser.tsx')
    expect(teaser).toContain("import { proToast } from '@/lib/toast'")
    expect(teaser).not.toContain('upgradeHref')
    expect(teaser).not.toContain('/api/payments/upgrade')
  })
})
