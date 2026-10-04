import { expect } from 'vitest'
import { db } from '@/config/db'
import type { McpAuthResult } from '@/lib/mcp/auth'
import { authFor, callAs, seedAgency, seedLead, seedUser, type ToolResult } from './fixtures'

/**
 * The shared lead-tool scenario. Agency A: admin a1, manager m1 (team with r1),
 * reps r1 and r2. Agency B: admin b1. Phone/email values are seeded on purpose
 * so every test can assert they never come back. `tag` keeps names unique per
 * test file.
 */

export const DAY = 24 * 3600 * 1000
export const PHONES = ['050-1234567', '0501234567', '1234567', '972501234567', '050-7654321', '7654321']
export const EMAILS = ['david@x.test', 'noa@x.test']

export async function seedLeadScenario(tag: string) {
  const A = await seedAgency(`__mcp_leads_A_${tag}__`)
  const B = await seedAgency(`__mcp_leads_B_${tag}__`)
  const a1 = await seedUser(A, 'ADMIN', 'Ada', 'Admin')
  const m1 = await seedUser(A, 'MNGR', 'Moshe', 'Manager')
  const r1 = await seedUser(A, 'AGNT', 'Rina', 'Rep')
  const r2 = await seedUser(A, 'AGNT', 'Bob', 'Rep')
  const b1 = await seedUser(B, 'ADMIN', 'Bella', 'Other')
  const [team] = await db('teams')
    .insert({ name: `__mcp_team_${tag}__`, agencyId: A })
    .returning('id')
  await db('user_teams').insert([
    { userId: m1, teamId: team.id, type: 'mngr' },
    { userId: r1, teamId: team.id, type: 'user' },
  ])

  const now = Date.now()
  const L1 = await seedLead(A, r1, 'David', 'Levi', {
    phone: '050-1234567',
    email: 'david@x.test',
    leadSource: 'whatsapp:wamid.HBgMOTcyNTAxMjM0NTY3',
    nextFollowUpAt: new Date(now - 2 * DAY),
    followUpNote: 'call about Pro plan, his cell 050-7654321 or david@x.test',
    lastOutcomeType: 'call_reached',
    lastActivityAt: new Date(now - 1000),
  })
  const L2 = await seedLead(A, r2, 'Dana', 'Cohen', {
    status: 'interested',
    phone: '052-9999999',
    nextFollowUpAt: new Date(now - 3 * DAY),
    followUpNote: 'Dana note',
  })
  const L3 = await seedLead(A, r1, 'Legacy', 'Lead', { status: 'true' })
  const L4 = await seedLead(A, r1, 'Noa', 'Bar', {
    status: 'contacted',
    email: 'noa@x.test',
    nextFollowUpAt: new Date(now + 2 * DAY),
  })
  const L5 = await seedLead(A, r1, 'Closed', 'Davidson', { status: 'closed', nextFollowUpAt: new Date(now - 2 * DAY) })
  const LDEAL = await seedLead(A, r1, 'David', 'Deal', { lead: false })
  const Lb = await seedLead(B, b1, 'David', 'Bader', { nextFollowUpAt: new Date(now - 2 * DAY), phone: '050-1234567' })
  return { A, B, a1, m1, r1, r2, b1, L1, L2, L3, L4, L5, LDEAL, Lb }
}

/** Per-file caller with one cached principal per user. */
export function makeCaller() {
  const auths = new Map<number, McpAuthResult>()
  const as = async (userId: number, agencyId: number) => {
    if (!auths.has(userId)) auths.set(userId, await authFor(userId, agencyId))
    return auths.get(userId)!
  }
  const call = async (userId: number, agencyId: number, name: string, args: Record<string, unknown> = {}) =>
    callAs(await as(userId, agencyId), name, args)
  return { as, call }
}

export const ids = (r: ToolResult) => (r.structuredContent?.items as { leadId: number }[]).map((i) => i.leadId).sort()
export const errCode = (r: ToolResult) => r.structuredContent?.error?.code

export function expectNoContactData(r: ToolResult) {
  const json = JSON.stringify(r)
  for (const v of [...PHONES, ...EMAILS]) expect(json).not.toContain(v)
  expect(json).not.toMatch(/"(phone|email|secPhone|customerWaId|waId|idNum)"\s*:/)
  expect(json).not.toContain('wamid')
}
