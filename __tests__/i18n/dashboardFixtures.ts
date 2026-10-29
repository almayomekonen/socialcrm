import type { LeadFact } from '@/lib/today/types'
import type { Roles } from '@/types/roles'
import type { DueWorklistRow } from '@/db/worklist'
import type { DashboardStats } from '@/lib/dashboard/stats'

/**
 * Fixed inputs for the /dashboard tests. Everything is derived from one
 * instant (2026-10-28 11:30 Asia/Jerusalem, UTC+2) so labels, durations and
 * business-day boundaries are deterministic. Customer names deliberately mix
 * Hebrew, Latin and Arabic: they are DATA and must render verbatim in every
 * locale.
 */
export const NOW = Date.parse('2026-10-28T09:30:00Z')
const H = 3_600_000
const D = 24 * H
const DAY_START = Date.parse('2026-10-27T22:00:00Z')

export const CUSTOMER_NAMES = ['דנה כהן', 'Sarah Miller', 'مريم أبو حامد', 'יוסי לוי', 'Omar Haddad', 'רונית']

export const FACTS: LeadFact[] = [
  // WAITING_REPLY — inbound 3h ago, never answered
  { id: 1, name: 'דנה כהן', phone: '0501234567', status: 'contacted', leadSource: 'whatsapp:972501234567', createdAt: NOW - 5 * D, nextFollowUpAt: null, lastActivityAt: NOW - 3 * H, lastInboundAt: NOW - 3 * H, lastHumanOutboundAt: null, hasOpenTask: false, earliestOpenTaskDueAt: null },
  // FOLLOWUP_OVERDUE — follow-up yesterday
  { id: 2, name: 'Sarah Miller', phone: '0527654321', status: 'contacted', leadSource: 'facebook:lead-123', createdAt: NOW - 9 * D, nextFollowUpAt: DAY_START - 5 * H, lastActivityAt: NOW - 2 * D, lastInboundAt: null, lastHumanOutboundAt: null, hasOpenTask: false, earliestOpenTaskDueAt: null },
  // FOLLOWUP_DUE_TODAY — follow-up this morning, website lead
  { id: 3, name: 'مريم أبو حامد', phone: null, status: 'interested', leadSource: 'contact_form_7:site', createdAt: NOW - 3 * D, nextFollowUpAt: DAY_START + 8 * H, lastActivityAt: NOW - D, lastInboundAt: null, lastHumanOutboundAt: null, hasOpenTask: false, earliestOpenTaskDueAt: null },
  // NEW_INBOUND — new Instagram lead from an hour ago
  { id: 4, name: 'יוסי לוי', phone: '0549998877', status: 'new', leadSource: 'instagram:ig-9', createdAt: NOW - H, nextFollowUpAt: null, lastActivityAt: NOW - H, lastInboundAt: null, lastHumanOutboundAt: null, hasOpenTask: false, earliestOpenTaskDueAt: null },
  // OVERDUE_TASK — manual lead with a task due two days ago
  { id: 5, name: 'Omar Haddad', phone: '0533332211', status: 'interested', leadSource: null, createdAt: NOW - 20 * D, nextFollowUpAt: null, lastActivityAt: NOW - 4 * D, lastInboundAt: null, lastHumanOutboundAt: null, hasOpenTask: true, earliestOpenTaskDueAt: DAY_START - 2 * D },
  // OPEN_LOOP_SLA — contacted, untouched 30h, nothing scheduled
  { id: 6, name: 'רונית', phone: '0521112233', status: 'contacted', leadSource: 'manual', createdAt: NOW - 6 * D, nextFollowUpAt: null, lastActivityAt: NOW - 30 * H, lastInboundAt: null, lastHumanOutboundAt: null, hasOpenTask: false, earliestOpenTaskDueAt: null },
]

export const WAITERS = [
  { conversationId: 501, leadId: 1, name: 'דנה כהן', phone: '0501234567', status: 'contacted', lastInboundAt: new Date(NOW - 3 * H), lastHumanOutboundAt: null },
]

export const MEETINGS = [
  { id: 11, title: 'שיחת היכרות', startAt: '2026-10-28T12:00:00Z', leadId: 2, leadName: 'Sarah Miller', meetUrl: 'https://meet.example/abc' },
  { id: 12, title: '', startAt: '2026-10-28T15:30:00Z', leadId: null, leadName: null, meetUrl: null },
]

export const VIEWER = { scope: { user: { role: 'ADMIN' as Roles }, gotPermIds: [] as number[] }, agencyId: 103, userId: 9001, firstName: 'דנה' }

export const DUE_ROWS: DueWorklistRow[] = [
  { id: 2, name: 'Sarah Miller', phone: '0527654321', status: 'contacted', leadSource: 'facebook:lead-123', nextFollowUpAt: new Date(DAY_START - 5 * H), followUpNote: 'להתקשר אחרי 16:00', statusChangedAt: null, lastOutcomeType: null, lastActivityAt: null },
  { id: 3, name: 'مريم أبو حامد', phone: null, status: 'interested', leadSource: 'contact_form_7:site', nextFollowUpAt: new Date(DAY_START + 8 * H), followUpNote: null, statusChangedAt: null, lastOutcomeType: null, lastActivityAt: null },
  { id: 9, name: 'Lior', phone: '0500000009', status: 'contacted', leadSource: null, nextFollowUpAt: null, followUpNote: null, statusChangedAt: null, lastOutcomeType: 'call_no_answer', lastActivityAt: null },
]

export const NEW_LEADS: DueWorklistRow[] = [
  { id: 4, name: 'יוסי לוי', phone: '0549998877', status: 'new', leadSource: 'instagram:ig-9', nextFollowUpAt: null, followUpNote: null, statusChangedAt: null, lastOutcomeType: null, lastActivityAt: null },
]

export const STATS: DashboardStats = {
  range: 14,
  days: Array.from({ length: 14 }, (_, i) => ({
    day: new Date(Date.UTC(2026, 9, 15 + i)).toISOString().slice(0, 10),
    newLeads: (i * 3) % 7,
    replied: (i * 2) % 5,
  })),
  newLeads: { total: 41, prevTotal: 33 },
  replied: { total: 28, prevTotal: 30 },
  responseMinutes: { avg: 47, prevAvg: 61, daily: Array.from({ length: 14 }, (_, i) => (i % 4 === 0 ? null : 30 + i)) },
  revenue: { total: 18400, prevTotal: 12000, deals: 3, daily: Array.from({ length: 14 }, (_, i) => (i % 5) * 1000) },
  sources: [
    { key: 'meta', label: 'פייסבוק / אינסטגרם', count: 19 },
    { key: 'whatsapp', label: 'WhatsApp', count: 12 },
    { key: 'website', label: 'אתר', count: 6 },
    { key: 'manual', label: 'ידני / ייבוא', count: 4 },
  ],
  funnel: [
    { key: 'new', label: 'חדש', count: 14 },
    { key: 'contacted', label: 'בטיפול', count: 11 },
    { key: 'interested', label: 'מעוניין', count: 7 },
    { key: 'closed', label: 'סגור', count: 5 },
  ],
  lost: 3,
  closeRate: 5 / 8,
}

/**
 * Which /dashboard variant the mocked page renders. Tests that mock the page's
 * reads (`dashboardHebrewBaseline`, `leakGate`, `dashboardLocales`) read this
 * from their vi.mock factories.
 */
export const dashboardEnv = { mobile: false, v2: true, stats: STATS as DashboardStats | null }

/**
 * Hebrew the /dashboard renders that is DATA, not interface: customer names
 * (and the avatar initials derived from them), the viewer's own first name, a
 * meeting title and a follow-up note — all user-authored. Nothing else Hebrew
 * may appear on a translated dashboard.
 */
export const DASHBOARD_CUSTOMER_DATA = [
  'דנה כהן',
  'דנה',
  'יוסי לוי',
  'רונית',
  'שיחת היכרות',
  'יל',
  'ר',
]
