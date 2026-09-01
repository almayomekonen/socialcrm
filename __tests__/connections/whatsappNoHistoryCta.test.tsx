// @vitest-environment jsdom
/**
 * There is no standalone history-sync control in the WhatsApp settings UI.
 *
 * History synchronisation belongs to Meta's Coexistence Embedded Signup, where
 * Meta collects the customer's consent to share their WhatsApp Business app
 * history. SocialCRM offers one WhatsApp action — connect / reconnect — and the
 * importer, webhooks and worker are driven by that flow, never by a button here.
 *
 * The defect this locks out: State C once rendered ONE button whose label
 * flipped to "סנכרן היסטוריית שיחות מהוואטסאפ" when the connection was healthy
 * and `is_on_biz_app` was true, while its onClick stayed `startEmbeddedSignup`.
 * It promised an import of the customer's history and opened an onboarding
 * dialog instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'fs'

const H = vi.hoisted(() => ({ launch: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
vi.mock('@/lib/facebook/useEmbeddedSignup', () => ({
  useEmbeddedSignup: () => ({ launch: H.launch }),
}))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({ useAccessDenied: () => false }))

import WhatsappConnect from '@/components/settings/WhatsappConnect'

const base = { pendingPhones: null, appId: 'a', configId: 'c', graphVersion: 'v19.0' as const }
const CONN = { phoneNumberId: '972007939322425' }
const HISTORY = /היסטוריית שיחות/
const RECONNECT = /לחבר מחדש/
const GREEN = /החיבור תקין/

afterEach(() => cleanup())

describe('no standalone history CTA', () => {
  it('a healthy connection offers no history control', () => {
    render(<WhatsappConnect {...base} connection={CONN} status='operational' />)
    expect(screen.getByText(GREEN)).toBeInTheDocument()
    expect(screen.queryByText(HISTORY)).not.toBeInTheDocument()
  })


  it('an unhealthy connection offers repair, never history copy', () => {
    render(<WhatsappConnect {...base} connection={CONN} status='token' />)
    expect(screen.getByRole('button', { name: RECONNECT })).toBeInTheDocument()
    expect(screen.queryByText(HISTORY)).not.toBeInTheDocument()
  })

  it('the reconnect control still drives Embedded Signup', () => {
    H.launch = vi.fn(() => new Promise(() => {}))
    render(<WhatsappConnect {...base} connection={CONN} status='token' />)
    screen.getByRole('button', { name: RECONNECT }).click()
    expect(H.launch).toHaveBeenCalledTimes(1)
  })

  it('no button anywhere in a healthy State C reaches Embedded Signup', () => {
    H.launch = vi.fn()
    render(<WhatsappConnect {...base} connection={CONN} status='operational' />)
    for (const button of screen.queryAllByRole('button')) button.click()
    expect(H.launch).not.toHaveBeenCalled()
  })

  it('SOURCE GUARD: no history label, and startEmbeddedSignup stays on connect/reconnect', () => {
    // A render test cannot stop a future edit from reintroducing the control.
    // Plain cwd-relative path: under jsdom `import.meta.url` is not a file: URL.
    const src = readFileSync('components/settings/WhatsappConnect.tsx', 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

    // No history-sync string survives as executable code (comments may explain it).
    expect(code).not.toMatch(/היסטוריית שיחות/)
    // Exactly two wirings: State A connect, State C reconnect.
    expect(code.match(/onClick=\{startEmbeddedSignup\}/g) ?? []).toHaveLength(2)
  })
})
