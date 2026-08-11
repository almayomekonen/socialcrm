// @vitest-environment jsdom
//
// The customer surface must not be able to render internal state, even when it
// is handed rows that contain it. These render the real components against
// deliberately over-populated data and assert the leak does not reach the DOM.

import { afterEach, test, expect } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'
import SupportThread from '@/components/support/SupportThread'
import SupportRequestList from '@/components/support/SupportRequestList'
import { toThreadMessages, toRequestSummaries } from '@/lib/support/presenters'

afterEach(cleanup)

const FORBIDDEN = ['authorUserId', 'agencyId', 'diagnostics', 'requestId', 'createdByUserId']

/** Rows carrying every internal field a real query would return. */
const messageRows = [
  {
    id: 1,
    requestId: 9,
    agencyId: 101,
    authorKind: 'customer',
    authorUserId: 5,
    body: 'הוואטסאפ לא מתחבר',
    createdAt: new Date('2026-08-10T08:00:00Z'),
  },
  {
    id: 2,
    requestId: 9,
    agencyId: 101,
    authorKind: 'support',
    authorUserId: 424242,
    body: 'בודקים את זה עכשיו',
    createdAt: new Date('2026-08-10T09:00:00Z'),
  },
] as any

const requestRows = [
  {
    id: 9,
    agencyId: 101,
    createdByUserId: 5,
    subject: 'הוואטסאפ לא מתחבר',
    status: 'waiting_for_customer',
    category: 'whatsapp',
    lastMessageAt: new Date('2026-08-10T09:00:00Z'),
    diagnostics: { agencyId: 101, browser: 'Chrome', clientRoute: '/settings/integrations' },
    requesterEmailSnapshot: 'dana@abc.co.il',
  },
] as any

test('the thread renders no internal field name', () => {
  const { container } = render(<SupportThread messages={toThreadMessages(messageRows, 5)} />)
  for (const f of FORBIDDEN) expect(container.innerHTML).not.toContain(f)
})

test("the platform owner's user id never reaches the DOM", () => {
  const { container } = render(<SupportThread messages={toThreadMessages(messageRows, 5)} />)
  expect(container.innerHTML).not.toContain('424242')
  expect(container.textContent).toContain('צוות SocialCRM')
})

test('a support reply is recognisable as SocialCRM, never as a person', () => {
  const { container } = render(<SupportThread messages={toThreadMessages(messageRows, 5)} />)
  const labels = [...container.querySelectorAll('li span')].map((s) => s.textContent)
  expect(labels).toContain('צוות SocialCRM')
  expect(labels).toContain('את/ה')
})

test('the request list renders no internal field, id or diagnostic', () => {
  const { container } = render(
    <SupportRequestList requests={toRequestSummaries(requestRows, 5)} />,
  )
  for (const f of FORBIDDEN) expect(container.innerHTML).not.toContain(f)
  expect(container.innerHTML).not.toContain('Chrome')
  expect(container.innerHTML).not.toContain('dana@abc.co.il')
  expect(container.innerHTML).not.toContain('/settings/integrations')
})

test('the list shows a human status, never a raw enum value', () => {
  const { container } = render(
    <SupportRequestList requests={toRequestSummaries(requestRows, 5)} />,
  )
  expect(container.textContent).toContain('ממתינה לתשובתך')
  expect(container.innerHTML).not.toContain('waiting_for_customer')
})

test('the list shows no category — that is a routing concept the customer never sees', () => {
  const { container } = render(
    <SupportRequestList requests={toRequestSummaries(requestRows, 5)} />,
  )
  expect(container.textContent).not.toContain('WhatsApp')
  expect(container.innerHTML).not.toContain('category')
})

test('an empty list renders nothing at all, never an empty table', () => {
  const { container } = render(<SupportRequestList requests={[]} />)
  expect(container.innerHTML).toBe('')
})

test('no emoji on the customer conversation surface', () => {
  const { container } = render(<SupportThread messages={toThreadMessages(messageRows, 5)} />)
  expect(/\p{Extended_Pictographic}/u.test(container.textContent ?? '')).toBe(false)
})
