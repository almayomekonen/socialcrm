/**
 * list_meetings against REAL SQL: owner scoping, tenant isolation, the
 * business-timezone day boundary, date ranges, empty results and what the
 * model is (and is not) handed.
 *
 * Fixed "now": Sunday 2026-11-08 10:00 in Jerusalem (08:00 UTC, winter +2).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { makeListMeetings } from '@/lib/agent/tools/listMeetings'
import { createEvidenceCollector } from '@/lib/agent/evidence'
import { createBudget } from '@/lib/agent/budget'
import type { AgentScope } from '@/lib/agent/types'
import { Roles } from '@/types/roles'
import { seedAgency, seedLead, seedUser } from '../../mcp/fixtures'

const NOW = Date.parse('2026-11-08T08:00:00Z')
const OPTS = { toolCallId: 't1', messages: [] } as never

let A: number, B: number, owner: number, rep: number, bOwner: number
let avi: number, dana: number, bLead: number

async function meeting(o: { agency: number; organizer: number; title: string; start: string; minutes?: number; status?: string; lead?: number | null; location?: string }) {
  const start = new Date(o.start)
  await db('meetings').insert({
    agency_id: o.agency,
    organizer_user_id: o.organizer,
    lead_id: o.lead ?? null,
    title: o.title,
    timezone: 'Asia/Jerusalem',
    start_at: start,
    end_at: new Date(start.getTime() + (o.minutes ?? 45) * 60_000),
    status: o.status ?? 'scheduled',
    location: o.location ?? null,
  })
}

beforeAll(async () => {
  A = await seedAgency('meetings-A')
  B = await seedAgency('meetings-B')
  owner = await seedUser(A, 'ADMIN', 'עלמה', 'בעלים')
  rep = await seedUser(A, 'AGNT', 'רון', 'נציג')
  bOwner = await seedUser(B, 'ADMIN', 'זר', 'זר')
  avi = await seedLead(A, owner, 'אבי', 'כהן', { status: 'contacted' })
  dana = await seedLead(A, owner, 'דנה', 'לוי')
  bLead = await seedLead(B, bOwner, 'סוד', 'מסוכנות-אחרת')

  await meeting({ agency: A, organizer: owner, title: 'פגישת היכרות', start: '2026-11-08T07:00:00Z', status: 'completed', lead: avi })
  await meeting({ agency: A, organizer: owner, title: 'שיחת צוות', start: '2026-11-08T12:00:00Z', location: 'משרד' })
  await meeting({ agency: A, organizer: owner, title: 'בוטלה', start: '2026-11-08T13:00:00Z', status: 'cancelled' })
  await meeting({ agency: A, organizer: rep, title: 'של הנציג', start: '2026-11-08T10:00:00Z' })
  await meeting({ agency: B, organizer: owner, title: 'סוכנות אחרת', start: '2026-11-08T11:00:00Z' })
  // 22:30 UTC on the 8th is 00:30 on the 9th in Jerusalem: "tomorrow", not "today".
  await meeting({ agency: A, organizer: owner, title: 'חצות', start: '2026-11-08T22:30:00Z', lead: dana })
  // A lead_id that points at another tenant's lead must never surface its name.
  await meeting({ agency: A, organizer: owner, title: 'ליד זר', start: '2026-11-09T08:00:00Z', lead: bLead })
  await meeting({ agency: A, organizer: owner, title: 'המשך עם אבי', start: '2026-11-10T09:00:00Z', lead: avi })
  await meeting({ agency: A, organizer: owner, title: 'שבוע הבא', start: '2026-11-16T09:00:00Z' })
})

afterAll(async () => {
  await db.destroy()
})

function build(scope: Partial<AgentScope> = {}) {
  const evidence = createEvidenceCollector()
  const full: AgentScope = { agencyId: A, userId: owner, role: Roles.ADMIN, gotPermIds: [], plan: 'pro', firstName: 'עלמה', ...scope }
  const t = makeListMeetings({ scope: full, evidence, budget: createBudget({ maxSteps: 20, deadlineMs: 60_000, now: () => 0 }), nowMs: NOW })
  const run = (input: Record<string, unknown>) =>
    (t as unknown as { execute: (i: unknown, o: unknown) => Promise<Record<string, any>> }).execute(input, OPTS)
  return { run, evidence }
}

const titles = (r: Record<string, any>) => (r.meetings as { title: string }[]).map((m) => m.title)

describe('which meetings: the owner\'s own, in their agency, cancelled hidden', () => {
  it('today, in time order, with business-time hours and status', async () => {
    const r = await build().run({ period: 'today' })
    expect(titles(r)).toEqual(['פגישת היכרות', 'שיחת צוות'])
    const [first, second] = r.meetings
    expect(first).toMatchObject({ start: '09:00', end: '09:45', status: 'התקיימה', alreadyStarted: true, date: '2026-11-08' })
    expect(first.lead).toMatchObject({ name: 'אבי כהן', status: 'contacted' })
    expect(second).toMatchObject({ start: '14:00', status: 'מתוכננת', alreadyStarted: false, location: 'משרד', lead: null })
  })

  it('never another organizer\'s meeting, never another agency\'s, never a cancelled one', async () => {
    const all = titles(await build().run({ period: 'this_week' }))
    expect(all).not.toContain('של הנציג')
    expect(all).not.toContain('סוכנות אחרת')
    expect(all).not.toContain('בוטלה')
  })

  it('the same tool for another user of the agency shows only that user\'s meetings', async () => {
    const r = await build({ userId: rep, role: Roles.AGNT }).run({ period: 'today' })
    expect(titles(r)).toEqual(['של הנציג'])
  })

  it('an organizer id from one agency reads nothing under another agency\'s scope', async () => {
    const r = await build({ agencyId: B }).run({ period: 'this_week' })
    expect(titles(r)).toEqual(['סוכנות אחרת'])
    expect(JSON.stringify(r)).not.toContain('אבי')
  })
})

describe('time windows in Asia/Jerusalem', () => {
  it('00:30 local belongs to tomorrow even though it is still the 8th in UTC', async () => {
    expect(titles(await build().run({ period: 'today' }))).not.toContain('חצות')
    const t = await build().run({ period: 'tomorrow' })
    expect(titles(t)).toEqual(['חצות', 'ליד זר'])
    expect(t.meetings[0]).toMatchObject({ start: '00:30', date: '2026-11-09' })
  })

  it('this week is Sunday to Saturday; next week is the one after', async () => {
    expect(titles(await build().run({ period: 'this_week' }))).toEqual(['פגישת היכרות', 'שיחת צוות', 'חצות', 'ליד זר', 'המשך עם אבי'])
    expect(titles(await build().run({ period: 'next_week' }))).toEqual(['שבוע הבא'])
  })

  it('a specific date', async () => {
    expect(titles(await build().run({ period: 'date', date: '2026-11-10' }))).toEqual(['המשך עם אבי'])
  })

  it('"what is my next meeting": upcoming starts now, so the morning meeting that already happened is not next', async () => {
    const r = await build().run({ period: 'upcoming' })
    expect(r.meetings[0].title).toBe('שיחת צוות')
  })

  it('"do I have a meeting with Avi": upcoming filtered by the lead', async () => {
    expect(titles(await build().run({ period: 'upcoming', leadId: avi }))).toEqual(['המשך עם אבי'])
  })
})

describe('what the model receives', () => {
  it('no meeting or lead ids anywhere; a linked lead is cited only by its evidence ref', async () => {
    const r = await build().run({ period: 'this_week' })
    const keys: string[] = []
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x))
    }
    walk(r)
    expect(keys.filter((k) => /^id$|Id$/.test(k))).toEqual([])
    expect(r.meetings.find((m: any) => m.title === 'פגישת היכרות').lead.evidenceRef).toBe(`lead:${avi}`)
  })

  it("another tenant's lead behind a stray lead_id is never named", async () => {
    const r = await build().run({ period: 'tomorrow' })
    expect(r.meetings.find((m: any) => m.title === 'ליד זר').lead).toBeNull()
    expect(JSON.stringify(r)).not.toContain('מסוכנות-אחרת')
  })

  it('an empty window is an explicit zero, recorded as evidence', async () => {
    const { run, evidence } = build()
    const r = await run({ period: 'date', date: '2026-12-25' })
    expect(r).toMatchObject({ count: 0, meetings: [], truncated: false })
    expect(evidence.all()).toContainEqual(expect.objectContaining({ kind: 'metric', metric: 'meetings.count', n: 0 }))
  })

  it('an impossible date is refused, not guessed', async () => {
    expect(await build().run({ period: 'date', date: '2026-02-30' })).toMatchObject({ invalidDate: true })
  })
})
