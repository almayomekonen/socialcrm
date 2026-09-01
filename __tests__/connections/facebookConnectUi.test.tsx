// @vitest-environment jsdom
/**
 * FB-UX regression tests — reason-specific recovery + the Oren no_pages
 * escalation (breaks the "fail → same connect button → fail" loop).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({ searchError: null as string | null, actionError: null as string | null }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === 'error' ? H.searchError : null) }),
}))
vi.mock('@/lib/useAction', () => ({
  useAction: () => ({ loading: false, error: H.actionError, setError: vi.fn(), run: (fn: () => unknown) => fn() }),
}))

import FacebookConnect from '@/components/settings/FacebookConnect'

beforeEach(() => {
  H.searchError = null
  H.actionError = null
  window.sessionStorage.clear()
})
afterEach(() => cleanup())

const notConnected = { connection: null, pendingPages: null, health: null }

describe('Facebook recovery UX', () => {
  it('FB-UX-1: first NO_PAGES → non-conclusive diagnosis, recovery guidance, retry not framed as the fix', async () => {
    H.searchError = 'no_pages'
    render(<FacebookConnect {...notConnected} />)
    expect(await screen.findByText('לא מצאנו דף Facebook שאפשר לחבר')).toBeInTheDocument()
    // recovery guidance is present (a "what to check" list)
    expect(screen.getByText(/ייתכן שהדף לא נבחר במסך האישור/)).toBeInTheDocument()
    // CTA is not a bare "try again" and does not assert a specific cause
    expect(screen.getByRole('button')).toHaveTextContent('בדקתי את הדף והגישה, לנסות להתחבר שוב')
    // must NOT conclusively claim the user has no Page
    expect(screen.queryByText(/אין לך דף/)).not.toBeInTheDocument()
    // escalated copy not shown yet
    expect(screen.queryByText('נראה שהחיבור עדיין לא מוצא דף מתאים')).not.toBeInTheDocument()
  })

  it('FB-UX-2: second identical NO_PAGES → ESCALATED guidance, retry de-emphasized but still available', async () => {
    window.sessionStorage.setItem('fbfail:no_pages', '1') // one prior failure this session
    H.searchError = 'no_pages'
    render(<FacebookConnect {...notConnected} />)
    // escalation appears
    expect(await screen.findByText('נראה שהחיבור עדיין לא מוצא דף מתאים')).toBeInTheDocument()
    // the plain first-failure title is replaced, not repeated identically
    expect(screen.queryByText('לא מצאנו דף Facebook שאפשר לחבר')).not.toBeInTheDocument()
    // retry still available (not hard-locked), framed as intentional recovery
    const btn = screen.getByRole('button')
    expect(btn).toHaveTextContent('בדקתי את הגישה לדף, לנסות שוב')
    // de-emphasized: uses the outline (secondary) style, not the solid primary
    expect(btn.className).toContain('border')
  })

  it('FB-UX-3: PAGES_PERMISSION_MISSING → permission-specific message + reauthorize CTA', async () => {
    H.searchError = 'pages_permission'
    render(<FacebookConnect {...notConnected} />)
    expect(await screen.findByText('חסרה הרשאה להצגת הדפים שלך')).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveTextContent('להתחבר ולאשר הרשאות')
  })

  it('FB-UX-4: LEADS_PERMISSION_MISSING → leads-permission-specific message', async () => {
    H.searchError = 'missing_permission'
    render(<FacebookConnect {...notConnected} />)
    expect(await screen.findByText('חסרה הרשאה לקבלת לידים')).toBeInTheDocument()
  })

  it('FB-UX-5: ACCESS_DENIED → "authorization not completed", not an app failure, nothing connected', async () => {
    H.searchError = 'denied'
    render(<FacebookConnect {...notConnected} />)
    expect(await screen.findByText('החיבור לפייסבוק לא הושלם')).toBeInTheDocument()
    expect(screen.queryByText(/לידים מגיעים אוטומטית/)).not.toBeInTheDocument()
  })

  it('FB-UX-6: RESOURCE_CLAIMED → safe conflict message, no other-agency identity leaked', async () => {
    H.actionError = 'resource_claimed'
    render(<FacebookConnect connection={null} pendingPages={[{ id: 'PG1', name: 'דף', access_token: 't' }]} health={null} />)
    expect(await screen.findByText('הדף כבר מחובר לחשבון אחר')).toBeInTheDocument()
    // no numeric agency id leaked anywhere in the rendered notice
    expect(document.body.textContent).not.toMatch(/\b999\b/)
  })
})

/**
 * The comment-text permission notice is suppressed.
 *
 * Production 2026-09: `pages_read_user_content` is unapproved, so the capability
 * check reported it missing and the settings page showed
 * "תוכן התגובות עדיין לא זמין" with a "להתחבר שוב ולאשר" CTA — while comments
 * were arriving WITH their text and לידים kept coming. The notice told customers
 * something was broken that demonstrably worked, and its CTA led to a reconnect
 * that changed nothing.
 *
 * `commentsNeedReconnect` is still computed and still passed. These tests pin
 * that it renders nothing, so the notice cannot return by accident.
 */
describe('comment-text permission notice is not shown', () => {
  const connected = {
    connection: { pageId: '1', pageName: 'Socialcrm' },
    pendingPages: null,
    health: { tokenValid: true, permissionsOk: true, subscribed: true, needsReconnect: false, errors: [] },
  }

  it('renders no permission warning when the capability says the grant is missing', () => {
    render(<FacebookConnect {...connected} commentsNeedReconnect />)
    expect(screen.queryByText(/תוכן התגובות עדיין לא זמין/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /להתחבר שוב ולאשר/ })).not.toBeInTheDocument()
  })

  it('keeps the healthy state exactly as it was', () => {
    render(<FacebookConnect {...connected} commentsNeedReconnect />)
    expect(screen.getByText(/מחובר לדף/)).toBeInTheDocument()
    expect(screen.getByText(/Socialcrm/)).toBeInTheDocument()
    expect(screen.getByText(/החיבור תקין/)).toBeInTheDocument()
  })

  it('a genuinely expired token still gets its own reconnect prompt', () => {
    // Suppressing the comment notice must not suppress real health warnings.
    render(
      <FacebookConnect
        {...connected}
        health={{ tokenValid: false, permissionsOk: true, subscribed: true, needsReconnect: true, errors: [] }}
        commentsNeedReconnect
      />,
    )
    expect(screen.getByText(/החיבור לפייסבוק פג/)).toBeInTheDocument()
  })
})
