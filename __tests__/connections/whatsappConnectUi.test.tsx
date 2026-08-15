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

const PHONE_ID = '1216762448189306'
const base = { pendingPhones: null, appId: 'a', configId: 'c', graphVersion: 'v19.0' as const }
const GREEN = 'החיבור תקין — לידים מגיעים אוטומטית'

beforeEach(() => {
  H.actionError = null
})
afterEach(() => cleanup())

describe('WhatsApp connection truth', () => {
  it('WA-UX-4: proven operational → green "leads arrive" claim', () => {
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='operational' />)
    expect(screen.getByText(GREEN)).toBeInTheDocument()
  })

  it('WA-UX-3: unknown / unverified row → NEVER claims leads arrive; shows verify state', () => {
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='unknown' />)
    expect(screen.queryByText(GREEN)).not.toBeInTheDocument()
    expect(screen.getByText('צריך לאמת את חיבור ה-WhatsApp')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /לחבר מחדש ולאמת/ })).toBeInTheDocument()
  })

  it('WA-UX-2: registration_pending → needs-action state, no green claim', () => {
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='registration_pending' />)
    expect(screen.queryByText(GREEN)).not.toBeInTheDocument()
    expect(screen.getByText('הגדרת מספר ה-WhatsApp עדיין לא הושלמה')).toBeInTheDocument()
  })

  it('WA-UX-1: SUBSCRIBED_APPS_FAILED (no connection persisted) → "setup incomplete", never connected', () => {
    H.actionError = 'subscribe_incomplete'
    render(<WhatsappConnect {...base} connection={null} status='disconnected' />)
    expect(screen.getByText('החיבור ל-WhatsApp עדיין לא הושלם')).toBeInTheDocument()
    expect(screen.queryByText(GREEN)).not.toBeInTheDocument()
  })

  it('WA-UX-5: RESOURCE_CLAIMED → safe conflict message, no tenant leak', () => {
    H.actionError = 'resource_claimed'
    render(<WhatsappConnect {...base} connection={null} status='disconnected' />)
    expect(screen.getByText('המספר כבר מחובר לחשבון אחר')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\b999\b/)
  })

  it('restricted never displays green/operational', () => {
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='restricted' />)
    expect(screen.queryByText(GREEN)).not.toBeInTheDocument()
    expect(screen.getByText('לא ניתן לשלוח הודעות כרגע')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /לחבר מחדש/ })).not.toBeInTheDocument()
  })

  it('token state uses the live-token notice, not green', () => {
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='token' />)
    expect(screen.queryByText(GREEN)).not.toBeInTheDocument()
    expect(screen.getByText('החיבור לוואטסאפ פג')).toBeInTheDocument()
  })

  it('webhook state is not operational', () => {
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='webhook' />)
    expect(screen.queryByText(GREEN)).not.toBeInTheDocument()
    expect(screen.getByText('החיבור ל-WhatsApp עדיין לא הושלם')).toBeInTheDocument()
  })

  it('never shows an internal Meta phone_number_id', () => {
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='operational' />)
    expect(screen.queryByText(/מספר מזוהה/)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(PHONE_ID)
  })
})
