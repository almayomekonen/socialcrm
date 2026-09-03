// @vitest-environment jsdom
/**
 * User management carries no vertical-specific business fields.
 *
 * `/settings/edit_users` used to edit seven "goals" keyed by Israeli insurance
 * product categories — `סיכונים` (risk), `פנסיוני-שוטף`/`פנסיוני-ניוד` (pension),
 * `פיננסים`/`פיננסים-שוטף` (financial), `אלמנטרי` (P&C), `משוקלל` (weighted
 * premium) — behind relabelled generic captions. Six of the seven were already
 * inert: `getGoalsAndTotals` keys totals by BRANCH name, and those keys no longer
 * intersect the goal keys except on `משוקלל`.
 *
 * These tests assert the removal at BOTH layers, because hiding the inputs while
 * the allowlist still accepts the field is exactly the superficial cleanup this
 * change exists to avoid. The db column and `/sum_sales` are deliberately
 * untouched — historical data still reads.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  writes: [] as Record<string, unknown>[],
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/requireUser', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, requireProductAccess: async () => h.user, requireAgencyUser: async () => h.user }
})
vi.mock('@/db/usersNTeams', () => ({ getUserNameById: async () => 'x' }))
vi.mock('@/lib/form/funcs', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, normalizeDefaultSettings: (x: unknown) => x }
})
vi.mock('@/config/db', () => {
  const qb: Record<string, unknown> = {}
  for (const m of ['where', 'whereIn', 'select', 'join', 'orderBy', 'returning', 'clone', 'whereNot']) qb[m] = () => qb
  qb.first = async () => ({ id: 99 })
  const record = (payload: unknown) => {
    if (payload && typeof payload === 'object') h.writes.push(payload as Record<string, unknown>)
    return qb
  }
  qb.insert = record
  qb.update = record
  qb.del = () => qb
  qb.delete = qb.del
  qb.then = (resolve: (v: unknown) => unknown) => Promise.resolve([{ id: 1 }]).then(resolve)
  return { db: Object.assign(() => qb, { transaction: async () => {}, raw: () => ({}) }) }
})

const ADMIN = { id: 1, role: 'ADMIN', agencyId: 10 }
const GOALS_PAYLOAD = { 'סיכונים': 100, 'פיננסים': 200, 'משוקלל': 300 }
/** Every legacy key, so a partial re-introduction cannot slip through. */
const LEGACY_KEYS = ['סיכונים', 'פנסיוני-שוטף', 'פנסיוני-ניוד', 'פיננסים', 'פיננסים-שוטף', 'אלמנטרי', 'משוקלל']

beforeEach(() => {
  h.user = ADMIN
  h.writes = []
})

describe('the user editor exposes no vertical-specific fields', () => {
  async function renderEditor(role = 'AGNT') {
    const { default: EditUser } = await import('@/components/agntsAndGrps/EditUser')
    render(
      <EditUser
        user={{ id: 5, name: 'דנה', role, firstName: 'דנה', lastName: 'כהן', goals: { 'משוקלל': 300 }, gotPerm: [] }}
        agnts={[]}
        teams={[]}
      />,
    )
  }

  it('renders no input whose name starts with goals.', async () => {
    await renderEditor()
    const named = Array.from(document.querySelectorAll('[name]')).map((el) => el.getAttribute('name') ?? '')
    expect(named.filter((n) => n.startsWith('goals.'))).toEqual([])
  })

  it('renders no input for any individual legacy key, even with historical data present', async () => {
    await renderEditor()
    const html = document.body.innerHTML
    for (const key of LEGACY_KEYS) expect(html).not.toContain(`goals.${key}`)
  })

  it('no longer shows the יעדים section heading', async () => {
    await renderEditor()
    expect(screen.queryByText('יעדים')).toBeNull()
  })

  it('still renders the generic CRM identity fields', async () => {
    await renderEditor()
    const named = Array.from(document.querySelectorAll('[name]')).map((el) => el.getAttribute('name'))
    for (const f of ['firstName', 'lastName', 'email', 'phone', 'role']) expect(named).toContain(f)
  })

  it('still renders role management and suspension', async () => {
    await renderEditor()
    const named = Array.from(document.querySelectorAll('[name]')).map((el) => el.getAttribute('name'))
    expect(named).toContain('role')
    expect(named).toContain('suspended')
  })

  it('still renders the OFFICE permission selector', async () => {
    await renderEditor('OFFICE')
    expect(screen.getByText('הרשאות')).toBeTruthy()
  })
})

describe('the users table and its export carry no goal columns', () => {
  it('has no goals.* column', async () => {
    const { usersTableHeaders } = await import('@/components/agntsAndGrps/UsersTable')
    expect(usersTableHeaders.filter((c) => String(c.key).startsWith('goals'))).toEqual([])
  })

  it('mentions no legacy key in any column key or label', async () => {
    const { usersTableHeaders } = await import('@/components/agntsAndGrps/UsersTable')
    const blob = JSON.stringify(usersTableHeaders)
    for (const key of LEGACY_KEYS) expect(blob).not.toContain(key)
  })

  it('keeps the generic user-management columns', async () => {
    const { usersTableHeaders } = await import('@/components/agntsAndGrps/UsersTable')
    const keys = usersTableHeaders.map((c) => c.key)
    for (const k of ['name', 'role', 'email', 'phone', 'suspended', 'gavePerm', 'gotPerm']) {
      expect(keys).toContain(k)
    }
  })
})

describe('the server actions no longer accept a goals payload', () => {
  it('upsertUser writes no goals key', async () => {
    const { upsertUser } = await import('@/actions/usersNteams')
    await upsertUser({ firstName: 'דנה', goals: GOALS_PAYLOAD }, 5)
    expect(h.writes.length).toBeGreaterThan(0)
    for (const w of h.writes) expect(Object.keys(w)).not.toContain('goals')
  })

  it('upsertUserNPerms writes no goals key', async () => {
    const { upsertUserNPerms } = await import('@/actions/usersNteams')
    await upsertUserNPerms({ firstName: 'דנה', role: 'OFFICE', goals: GOALS_PAYLOAD, gotPermIds: [] }, 5)
    for (const w of h.writes) expect(Object.keys(w)).not.toContain('goals')
  })

  it('a goals payload cannot reach the database under any key name', async () => {
    const { upsertUser } = await import('@/actions/usersNteams')
    await upsertUser({ firstName: 'דנה', goals: GOALS_PAYLOAD }, 5)
    const blob = JSON.stringify(h.writes)
    for (const key of LEGACY_KEYS) expect(blob).not.toContain(key)
  })

  it('still writes the legitimate identity fields', async () => {
    const { upsertUser } = await import('@/actions/usersNteams')
    await upsertUser({ firstName: 'דנה', lastName: 'כהן', email: 'D@Example.com', phone: '050', goals: GOALS_PAYLOAD }, 5)
    const w = h.writes[0]
    expect(w.firstName).toBe('דנה')
    expect(w.lastName).toBe('כהן')
    expect(w.email).toBe('d@example.com') // still lower-cased
    expect(w.phone).toBe('050')
  })

  it('still writes role and suspension — RBAC-relevant fields are untouched', async () => {
    const { upsertUser } = await import('@/actions/usersNteams')
    await upsertUser({ role: 'MNGR', suspended: true }, 5)
    const w = h.writes[0]
    expect(w.role).toBe('MNGR')
    expect(w.suspended).toBe(true)
  })
})

describe('the dead insurance-agent licence fields are no longer writable', () => {
  it('updateFullUser writes no agentLicence field', async () => {
    const { updateFullUser } = await import('@/actions/usersNteams')
    await updateFullUser({
      userInfoData: { agentLicenseNum: 'X1', agentLicenseType: 'רישיון מלא', agentLicenseName: 'Y', officePhone: '03' },
    })
    const blob = JSON.stringify(h.writes)
    expect(blob).not.toContain('agentLicense')
  })

  it('still writes the generic user-info fields beside them', async () => {
    const { updateFullUser } = await import('@/actions/usersNteams')
    await updateFullUser({ userInfoData: { officePhone: '03', tifulEmail: 'a@b.c', agentLicenseNum: 'X1' } })
    const w = h.writes[0]
    expect(w.officePhone).toBe('03')
    expect(w.tifulEmail).toBe('a@b.c')
    expect(Object.keys(w)).not.toContain('agentLicenseNum')
  })
})
