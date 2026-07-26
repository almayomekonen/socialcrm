// @vitest-environment jsdom
/**
 * WA-UX regression tests — connection truth. The green "leads arrive
 * automatically" claim may appear ONLY for a proven-operational status.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({ actionError: null as string | null }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
vi.mock('@/lib/useAction', () => ({
  useAction: () => ({ loading: false, error: H.actionError, setError: vi.fn(), run: (fn: () => unknown) => fn() }),
}))
vi.mock('@/lib/facebook/useEmbeddedSignup', () => ({
  useEmbeddedSignup: () => ({ launch: vi.fn(async () => ({ ok: false, error: 'cancelled' })) }),
}))

import WhatsappConnect from '@/components/settings/WhatsappConnect'

const base = { pendingPhones: null, appId: 'a', configId: 'c', graphVersion: 'v19.0' as const }
const GREEN = 'החיבור תקין — לידים מגיעים אוטומטית'

beforeEach(() => {
  H.actionError = null
})
afterEach(() => cleanup())

describe('WhatsApp connection truth', () => {
  it('WA-UX-4: proven operational (agency-103-like) → green "leads arrive" claim', () => {
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: 'P1' }} status='operational' />)
    expect(screen.getByText(GREEN)).toBeInTheDocument()
  })

  it('WA-UX-3: legacy unverified row (Oren-like) → NEVER claims leads arrive; shows verify state', () => {
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: 'P1' }} status='needs_verification' />)
    expect(screen.queryByText(GREEN)).not.toBeInTheDocument()
    expect(screen.getByText('צריך לאמת את חיבור ה-WhatsApp')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /לחבר מחדש ולאמת/ })).toBeInTheDocument()
  })

  it('WA-UX-2: PHONE_NOT_READY → needs-action state, no green claim', () => {
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: 'P1' }} status='not_ready' />)
    expect(screen.queryByText(GREEN)).not.toBeInTheDocument()
    expect(screen.getByText('הגדרת מספר ה-WhatsApp עדיין לא הושלמה')).toBeInTheDocument()
  })

  it('WA-UX-1: SUBSCRIBED_APPS_FAILED (no connection persisted) → "setup incomplete", never connected', () => {
    H.actionError = 'subscribe_incomplete'
    render(<WhatsappConnect {...base} connection={null} status='needs_verification' />)
    expect(screen.getByText('החיבור ל-WhatsApp עדיין לא הושלם')).toBeInTheDocument()
    expect(screen.queryByText(GREEN)).not.toBeInTheDocument()
  })

  it('WA-UX-5: RESOURCE_CLAIMED → safe conflict message, no tenant leak', () => {
    H.actionError = 'resource_claimed'
    render(<WhatsappConnect {...base} connection={null} status='needs_verification' />)
    expect(screen.getByText('המספר כבר מחובר לחשבון אחר')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\b999\b/)
  })
})
