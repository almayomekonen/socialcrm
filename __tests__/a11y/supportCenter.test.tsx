// @vitest-environment jsdom
//
// Landmark, RTL and care-surface checks for the (support) route group, mirroring
// __tests__/a11y/landmarks.test.tsx.

import { afterEach, test, expect } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import SupportShell from '@/components/support/SupportShell'

afterEach(cleanup)

const user = { name: 'דנה לוי', email: 'dana@abc.co.il', role: 'AGNT' }

function renderShell(children: React.ReactNode = <p>content</p>) {
  return render(<SupportShell user={user as any}>{children}</SupportShell>)
}

// --- landmarks ---

test('the shell renders exactly one <main>', () => {
  const { container } = renderShell()
  expect(container.querySelectorAll('main')).toHaveLength(1)
})

test('the main landmark carries the skip-link target id', () => {
  const { container } = renderShell()
  expect(container.querySelector('main')!.getAttribute('id')).toBe('main-content')
})

test('the skip link is present and targets the main landmark', () => {
  renderShell()
  const skip = screen.getByRole('link', { name: 'דלג לתוכן' })
  expect(skip.getAttribute('href')).toBe('#main-content')
})

test('there is exactly one banner landmark', () => {
  const { container } = renderShell()
  expect(container.querySelectorAll('header')).toHaveLength(1)
})

// --- navigation ---

test('there is a visible way back to the workspace', () => {
  renderShell()
  expect(screen.getByRole('link', { name: /חזרה למערכת/ })).toBeTruthy()
})

test('the back link points at the workspace, not at history', () => {
  renderShell()
  const back = screen.getByRole('link', { name: /חזרה למערכת/ })
  expect(back.getAttribute('href')).toBe('/dashboard')
})

// --- RTL ---

test('the shell declares RTL explicitly rather than inheriting silently', () => {
  const { container } = renderShell()
  expect(container.querySelector('[dir="rtl"]')).toBeTruthy()
})

test('no physical-direction utilities are used — RTL must not depend on LTR classes', () => {
  const { container } = renderShell()
  const html = container.innerHTML
  for (const banned of ['text-left', 'text-right', 'ml-', 'mr-', 'pl-', 'pr-', 'left-', 'right-']) {
    expect(html).not.toContain(`"${banned}`)
    expect(html).not.toContain(` ${banned}`)
  }
})

// --- care surface, not a helpdesk ---

test('the shell shows no trial, plan, upgrade or billing language', () => {
  const { container } = renderShell()
  const text = container.textContent ?? ''
  for (const forbidden of ['שדרג', 'ניסיון', 'PRO', 'תשלום', 'חיוב']) {
    expect(text).not.toContain(forbidden)
  }
})

test('the shell exposes no ticket, queue or agent vocabulary', () => {
  const { container } = renderShell()
  const text = container.textContent ?? ''
  for (const forbidden of ['כרטיס', 'תור', 'סוכן', 'SLA', 'עדיפות']) {
    expect(text).not.toContain(forbidden)
  }
})

test('no internal identifier appears in the chrome', () => {
  const { container } = renderShell()
  const html = container.innerHTML
  for (const forbidden of ['agencyId', 'requestId', 'userId', 'diagnostics']) {
    expect(html).not.toContain(forbidden)
  }
})

test('no emoji anywhere in the shell', () => {
  const { container } = renderShell()
  expect(/\p{Extended_Pictographic}/u.test(container.textContent ?? '')).toBe(false)
})

// --- it must host every Phase 2 screen, not just the landing page ---

test('arbitrary page content renders inside the single main landmark', () => {
  const { container } = renderShell(
    <>
      <h1>שיחה</h1>
      <ol>
        <li>הודעה</li>
      </ol>
    </>,
  )
  const main = container.querySelector('main')!
  expect(main.querySelector('h1')!.textContent).toBe('שיחה')
  expect(main.querySelectorAll('li')).toHaveLength(1)
  // The shell contributes no heading of its own, so a page's h1 is the first.
  expect(container.querySelectorAll('h1')).toHaveLength(1)
})
