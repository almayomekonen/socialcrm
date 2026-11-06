/**
 * Lead-detail reads and the AI prompts they feed, against REAL SQL.
 *
 * Proves on Postgres:
 *   - the sessionless reads (db/agentLeadDetail.ts): join, columns, tenant pin;
 *   - BOTH paths (session = web AI, supplied agency = Agent / WhatsApp) read the
 *     rep's real `lead_notes` and never the GENERATED `clients.details`
 *     (`firstName lastName (idNum)`);
 *   - no prompt built from the snapshot carries the lead's ID number, while the
 *     note's business content survives.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn<() => Promise<unknown>>(async () => null) }))
vi.mock('@/db/auth', () => ({ getUser }))

import { db } from '@/config/db'
import { getLeadIntelligenceInputs } from '@/db/aiSummaries'
import { buildLeadIntelUserMessage } from '@/lib/ai/prompts/leadIntelligence'
import { buildLeadFollowupUserMessage } from '@/lib/ai/prompts/leadFollowup'
import { buildLeadNextStepUserMessage } from '@/lib/ai/prompts/leadNextStep'
import { buildLeadAskQuestionUserMessage } from '@/lib/ai/prompts/leadAskQuestion'
import { buildWhatsappReplyUserMessage } from '@/lib/ai/prompts/whatsappReplyDraft'
import { seedAgency, seedLead, seedUser } from '../../mcp/fixtures'

const ID = '039876541'
const OTHER_VALID_ID = '123456782'
let A: number, B: number, admin: number, rep: number, lead: number, otherTenantLead: number

beforeAll(async () => {
  A = await seedAgency('lead-detail-A')
  B = await seedAgency('lead-detail-B')
  admin = await seedUser(A, 'ADMIN', 'עלמה', 'מנהלת')
  rep = await seedUser(A, 'AGNT', 'רון', 'כהן')
  const bRep = await seedUser(B, 'AGNT', 'זר', 'זר')
  lead = await seedLead(A, rep, 'דנה', 'לוי', { leadSource: 'פייסבוק', handlerId: rep, idNum: ID, lastActivityAt: new Date(Date.now() - 3 * 86_400_000) })
  otherTenantLead = await seedLead(B, bRep, 'זר', 'זר')
  await db('tasks').insert([
    { clientId: lead, userId: rep, title: 'להתקשר לדנה', dueDate: '2020-01-01', completed: false },
    { clientId: lead, userId: rep, title: 'לשלוח הצעה', completed: true },
  ])
  await db('lead_notes').insert([
    { agencyId: A, leadId: lead, userId: rep, userName: 'רון כהן', content: `מעוניינת בחבילה הגדולה. ת"ז ${ID}`, createdAt: new Date(Date.now() - 60_000) },
    { agencyId: A, leadId: lead, userId: rep, userName: 'רון כהן', content: `רוצה לדבר שבוע הבא. בעלה ${OTHER_VALID_ID}`, createdAt: new Date() },
    // Another agency's note on its own lead: must never appear.
    { agencyId: B, leadId: otherTenantLead, userId: bRep, userName: 'זר', content: 'הערה של סוכנות אחרת' },
  ])
})

beforeEach(() => {
  getUser.mockReset()
  getUser.mockResolvedValue(null)
})

afterAll(async () => {
  await db.destroy()
})

describe('getLeadIntelligenceInputs with a supplied agency, no session (Agent / WhatsApp)', () => {
  it('reads the lead, its handler and its tasks', async () => {
    const snap = await getLeadIntelligenceInputs(lead, { agencyId: A })
    const i = snap!.inputs
    expect(i.leadSource).toBe('פייסבוק')
    expect(i.handlerName).toBeTruthy()
    expect(i.daysSinceLastInteraction).toBe(3)
    expect(i.overdueTaskCount).toBe(1)
    expect(i.taskCompletionRate).toBe(0.5)
    expect(i.recentTasks.map((t) => t.title).sort()).toEqual(['להתקשר לדנה', 'לשלוח הצעה'])
    expect(getUser).not.toHaveBeenCalled()
  })

  it("notes are the rep's lead_notes, newest first, with every ID masked", async () => {
    const notes = (await getLeadIntelligenceInputs(lead, { agencyId: A }))!.inputs.detailsExcerpt!
    expect(notes.indexOf('רוצה לדבר שבוע הבא')).toBeLessThan(notes.indexOf('מעוניינת בחבילה הגדולה'))
    expect(notes).not.toContain(ID)
    expect(notes).not.toContain(OTHER_VALID_ID)
    expect(notes).not.toContain('דנה לוי (') // the generated clients.details label
  })

  it("returns nothing for another agency's lead, and never its notes", async () => {
    await expect(getLeadIntelligenceInputs(otherTenantLead, { agencyId: A })).resolves.toBeNull()
    await expect(getLeadIntelligenceInputs(lead, { agencyId: B })).resolves.toBeNull()
    const notes = (await getLeadIntelligenceInputs(lead, { agencyId: A }))!.inputs.detailsExcerpt!
    expect(notes).not.toContain('סוכנות אחרת')
  })
})

describe('the web AI path (session) reads the same notes, masked', () => {
  it('an admin session gets the notes without the ID', async () => {
    getUser.mockResolvedValue({ id: admin, agencyId: A, role: 'ADMIN', suspended: false })
    const notes = (await getLeadIntelligenceInputs(lead))!.inputs.detailsExcerpt!
    expect(notes).toContain('רוצה לדבר שבוע הבא')
    expect(notes).not.toContain(ID)
  })
})

describe('no AI prompt built from the snapshot carries the ID number', () => {
  it.each(['agency', 'session'] as const)('%s path: every prompt keeps the note and drops the ID', async (path) => {
    if (path === 'session') getUser.mockResolvedValue({ id: admin, agencyId: A, role: 'ADMIN', suspended: false })
    const inputs = (await getLeadIntelligenceInputs(lead, path === 'agency' ? { agencyId: A } : {}))!.inputs
    const prompts = [
      buildLeadIntelUserMessage(inputs),
      buildLeadFollowupUserMessage(inputs, 'דנה לוי'),
      buildLeadNextStepUserMessage(inputs, 'דנה לוי'),
      buildLeadAskQuestionUserMessage({ inputs, leadName: 'דנה לוי', question: 'מה הסטטוס?', lenses: [] }),
      buildWhatsappReplyUserMessage(inputs, 'דנה לוי', []),
    ]
    for (const p of prompts) {
      expect(p).toContain('רוצה לדבר שבוע הבא')
      expect(p).not.toContain(ID)
      expect(p).not.toContain(OTHER_VALID_ID)
    }
  })
})
