/**
 * The sessionless lead-detail reads against REAL SQL (db/agentLeadDetail.ts via
 * getLeadIntelligenceInputs). The unit test stubs the database; this proves
 * the join, the column list and the tenant pin on Postgres, with no session.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn(async () => null) }))
vi.mock('@/db/auth', () => ({ getUser }))

import { db } from '@/config/db'
import { getLeadIntelligenceInputs } from '@/db/aiSummaries'
import { seedAgency, seedLead, seedUser } from '../../mcp/fixtures'

let A: number, B: number, rep: number, lead: number, otherTenantLead: number

beforeAll(async () => {
  A = await seedAgency('lead-detail-A')
  B = await seedAgency('lead-detail-B')
  rep = await seedUser(A, 'AGNT', 'רון', 'כהן')
  const bRep = await seedUser(B, 'AGNT', 'זר', 'זר')
  lead = await seedLead(A, rep, 'דנה', 'לוי', { leadSource: 'פייסבוק', handlerId: rep, idNum: '039876541', lastActivityAt: new Date(Date.now() - 3 * 86_400_000) })
  otherTenantLead = await seedLead(B, bRep, 'זר', 'זר')
  await db('tasks').insert([
    { clientId: lead, userId: rep, title: 'להתקשר לדנה', dueDate: '2020-01-01', completed: false },
    { clientId: lead, userId: rep, title: 'לשלוח הצעה', completed: true },
  ])
})

afterAll(async () => {
  await db.destroy()
})

describe('getLeadIntelligenceInputs with a supplied agency, no session', () => {
  it('reads the lead, its handler and its tasks', async () => {
    const snap = await getLeadIntelligenceInputs(lead, { agencyId: A })
    expect(snap).not.toBeNull()
    const i = snap!.inputs
    expect(i.leadSource).toBe('פייסבוק')
    expect(i.handlerName).toBeTruthy()
    expect(i.daysSinceLastInteraction).toBe(3)
    expect(i.overdueTaskCount).toBe(1)
    expect(i.taskCompletionRate).toBe(0.5)
    expect(i.recentTasks.map((t) => t.title).sort()).toEqual(['להתקשר לדנה', 'לשלוח הצעה'])
    expect(getUser).not.toHaveBeenCalled()
  })

  it('clients.details really is the generated name + ID label (why get_lead no longer returns it)', async () => {
    const snap = await getLeadIntelligenceInputs(lead, { agencyId: A })
    expect(snap!.inputs.detailsExcerpt).toContain('039876541')
  })

  it("returns nothing for another agency's lead", async () => {
    await expect(getLeadIntelligenceInputs(otherTenantLead, { agencyId: A })).resolves.toBeNull()
    await expect(getLeadIntelligenceInputs(lead, { agencyId: B })).resolves.toBeNull()
  })
})
