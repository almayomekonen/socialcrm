import { test, expect } from 'vitest'
import { toThreadMessages, toRequestSummaries } from '@/lib/support/presenters'

const rows = [
  {
    id: 1,
    authorKind: 'customer',
    authorUserId: 5,
    body: 'לא מתחבר',
    createdAt: new Date('2026-08-10T08:00:00Z'),
  },
  {
    id: 2,
    authorKind: 'support',
    authorUserId: 42,
    body: 'בודקים',
    createdAt: new Date('2026-08-10T09:00:00Z'),
  },
  {
    id: 3,
    authorKind: 'system',
    authorUserId: null,
    body: 'הפנייה נפתחה',
    createdAt: new Date('2026-08-10T08:00:01Z'),
  },
] as any

// --- the platform owner's identity is structurally unrenderable ---

test('authorUserId is DROPPED from every projected message', () => {
  const out = toThreadMessages(rows, 5)
  for (const m of out) {
    expect(Object.keys(m).sort()).toEqual(['authorKind', 'authorLabel', 'body', 'createdAt', 'id'])
    expect((m as any).authorUserId).toBeUndefined()
  }
})

test('a support message is labelled צוות SocialCRM, never a person', () => {
  const support = toThreadMessages(rows, 5).find((m) => m.authorKind === 'support')!
  expect(support.authorLabel).toBe('צוות SocialCRM')
  expect(JSON.stringify(support)).not.toContain('42')
})

test('a system message is also labelled צוות SocialCRM', () => {
  const sys = toThreadMessages(rows, 5).find((m) => m.authorKind === 'system')!
  expect(sys.authorLabel).toBe('צוות SocialCRM')
})

test('the viewer sees their own message as את/ה', () => {
  expect(toThreadMessages(rows, 5).find((m) => m.id === 1)!.authorLabel).toBe('את/ה')
})

test('a colleague-authored message shows the requester name, not "you"', () => {
  const out = toThreadMessages(rows, 99, 'דנה לוי')
  expect(out.find((m) => m.id === 1)!.authorLabel).toBe('דנה לוי')
})

test('empty-bodied messages are dropped, never rendered as a blank bubble', () => {
  // The context-only opening message: the customer wrote nothing because
  // SocialCRM already knew what happened. The context card carries the meaning.
  const withEmpty = [
    { id: 9, authorKind: 'customer', authorUserId: 5, body: '', createdAt: new Date() },
    { id: 10, authorKind: 'customer', authorUserId: 5, body: '   ', createdAt: new Date() },
    { id: 11, authorKind: 'customer', authorUserId: 5, body: 'יש לי משהו להוסיף', createdAt: new Date() },
  ] as any
  const out = toThreadMessages(withEmpty, 5)
  expect(out.map((m) => m.id)).toEqual([11])
})

// --- the request list shows three things and nothing else ---

const summaryRow = {
  id: 9,
  subject: 'הוואטסאפ לא מתחבר',
  status: 'waiting_for_customer',
  category: 'whatsapp',
  lastMessageAt: new Date('2026-08-10T09:00:00Z'),
  agencyId: 101,
  createdByUserId: 5,
  diagnostics: { agencyId: 101, browser: 'Chrome' },
} as any

test('a summary carries only subject, human status and time', () => {
  const [s] = toRequestSummaries([summaryRow], 5)
  expect(Object.keys(s).sort()).toEqual(['id', 'lastActivityAt', 'statusLabel', 'statusRole', 'subject'])
})

test('the status is a human label with a semantic role, never a raw value', () => {
  const [s] = toRequestSummaries([summaryRow], 5)
  expect(s.statusLabel).toBe('ממתינה לתשובתך')
  expect(s.statusRole).toBe('warning')
  expect(JSON.stringify(s)).not.toContain('waiting_for_customer')
})

test('no category, agencyId or diagnostics reach the customer list', () => {
  const [s] = toRequestSummaries([summaryRow], 5)
  const blob = JSON.stringify(s)
  expect(blob).not.toContain('whatsapp')
  expect(blob).not.toContain('101')
  expect(blob).not.toContain('Chrome')
  expect((s as any).category).toBeUndefined()
  expect((s as any).categoryLabel).toBeUndefined()
  expect((s as any).agencyId).toBeUndefined()
  expect((s as any).diagnostics).toBeUndefined()
})

test('a request with no activity yet still projects cleanly', () => {
  const [s] = toRequestSummaries([{ ...summaryRow, lastMessageAt: null }], 5)
  expect(s.lastActivityAt).toBeNull()
})
