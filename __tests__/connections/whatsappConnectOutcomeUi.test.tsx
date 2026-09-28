// @vitest-environment jsdom
/**
 * What the business owner reads after Meta's window ends a connect attempt.
 *
 * Before: every cancel, whatever Meta said, rendered the same "not completed —
 * try again" notice. When Meta had shown an error such as a verification-code
 * lockout ("wait about 12 hours"), retrying at once could only fail again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({ launch: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
vi.mock('@/lib/facebook/useEmbeddedSignup', () => ({ useEmbeddedSignup: () => ({ launch: H.launch }) }))
vi.mock('@/lib/entitlement/EntitlementContext', () => ({ useAccessDenied: () => false }))

import WhatsappConnect from '@/components/settings/WhatsappConnect'

const base = { pendingPhones: null, appId: 'a', configId: 'c', graphVersion: 'v19.0' as const }
const META_TEXT = 'You have guessed too many times. Please wait about 12 hours.'

beforeEach(() => {
  H.launch = vi.fn()
})
afterEach(() => cleanup())

async function clickConnect(name: RegExp) {
  await act(async () => {
    screen.getByRole('button', { name }).click()
  })
}

describe('not connected (State A)', () => {
  it('shows Meta’s own error text and a retry', async () => {
    H.launch = vi.fn(async () => ({
      ok: false,
      error: 'cancelled',
      cancel: { errorReported: true, errorMessage: META_TEXT },
    }))
    render(<WhatsappConnect {...base} connection={null} status='unknown' />)
    await clickConnect(/חבר וואטסאפ עסקי/)

    expect(screen.getByText('לא הצלחנו להשלים את החיבור לוואטסאפ')).toBeInTheDocument()
    // Isolated (U+2068 … U+2069) so an English message keeps its punctuation in RTL.
    expect(screen.getByText(`ההודעה שהוצגה בחלון של Meta: ⁨"${META_TEXT}"⁩`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /לנסות שוב/ })).toBeEnabled()
  })

  it('names the verification step when Meta’s window closed there', async () => {
    H.launch = vi.fn(async () => ({
      ok: false,
      error: 'cancelled',
      cancel: { step: 'PHONE_NUMBER_VERIFICATION', errorReported: false },
    }))
    render(<WhatsappConnect {...base} connection={null} status='unknown' />)
    await clickConnect(/חבר וואטסאפ עסקי/)

    expect(screen.getByText('אימות המספר העסקי לא הושלם')).toBeInTheDocument()
    expect(screen.getByText(/הטלפון עם המספר העסקי בהישג יד/)).toBeInTheDocument()
  })

  it('a cancel with no word from Meta keeps the existing notice', async () => {
    H.launch = vi.fn(async () => ({ ok: false, error: 'cancelled' }))
    render(<WhatsappConnect {...base} connection={null} status='unknown' />)
    await clickConnect(/חבר וואטסאפ עסקי/)

    expect(screen.getByText('החיבור לוואטסאפ לא הושלם')).toBeInTheDocument()
  })

  it('a later plain cancel does not keep showing an earlier Meta message', async () => {
    // One mock, two answers: the rendered handler keeps the `launch` it closed over.
    H.launch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'cancelled', cancel: { errorReported: true, errorMessage: META_TEXT } })
      .mockResolvedValueOnce({ ok: false, error: 'cancelled' })
    render(<WhatsappConnect {...base} connection={null} status='unknown' />)
    await clickConnect(/חבר וואטסאפ עסקי/)
    expect(screen.getByText('לא הצלחנו להשלים את החיבור לוואטסאפ')).toBeInTheDocument()
    await clickConnect(/לנסות שוב/)

    expect(screen.queryByText(new RegExp(META_TEXT.slice(0, 20)))).not.toBeInTheDocument()
    expect(screen.getByText('החיבור לוואטסאפ לא הושלם')).toBeInTheDocument()
  })
})

describe('Meta’s text is shown safely, with the matching next step', () => {
  async function showMetaError(errorMessage: string) {
    H.launch = vi.fn(async () => ({ ok: false, error: 'cancelled', cancel: { errorReported: true, errorMessage } }))
    const view = render(<WhatsappConnect {...base} connection={null} status='unknown' />)
    await clickConnect(/חבר וואטסאפ עסקי/)
    return view
  }

  it('renders markup in Meta’s text as plain text, never as elements', async () => {
    const hostile = '<img src=x onerror="alert(1)"><b>bold</b>'
    const { container } = await showMetaError(hostile)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByText(new RegExp('<img src=x'))).toBeInTheDocument()
  })

  it('a documented Meta error gets its own next step', async () => {
    await showMetaError(META_TEXT)
    expect(screen.getByText(/להמתין כ-12 שעות/)).toBeInTheDocument()
  })

  it('an unrecognised Meta error keeps the general next step', async () => {
    await showMetaError('משהו אחר לגמרי')
    expect(screen.getByText(/לפעול לפי ההודעה של Meta/)).toBeInTheDocument()
  })
})

describe('reconnecting a saved connection (State C)', () => {
  it('a Meta error outranks the health notice', async () => {
    H.launch = vi.fn(async () => ({ ok: false, error: 'cancelled', cancel: { errorReported: true, errorMessage: META_TEXT } }))
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: '1' }} status='token' />)
    await clickConnect(/לחבר מחדש/)

    expect(screen.getByText('לא הצלחנו להשלים את החיבור לוואטסאפ')).toBeInTheDocument()
    expect(screen.queryByText('החיבור לוואטסאפ פג')).not.toBeInTheDocument()
  })
})
