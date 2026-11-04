// @vitest-environment jsdom
/** What the customer sees when the launch is pending, kept, or settles late. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({
  refresh: vi.fn(),
  launch: vi.fn(),
  resume: vi.fn(),
  discardKept: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: H.refresh, push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
vi.mock('@/lib/facebook/useEmbeddedSignup', () => ({
  useEmbeddedSignup: () => ({ launch: H.launch, resume: H.resume, discardKept: H.discardKept }),
}))

import WhatsappConnect from '@/components/settings/WhatsappConnect'

const base = { connection: null, pendingPhones: null, appId: 'a', configId: 'c', graphVersion: 'v19.0', status: 'disconnected' as const }
const PENDING_TITLE = 'ממתינים לסיום החיבור'
const CONFIRM = /אישור/
const SDK_TITLE = 'חלון ההתחברות לא נפתח'

function click() {
  return act(async () => {
    screen.getByRole('button').click()
  })
}

beforeEach(() => {
  H.refresh.mockClear()
  H.launch.mockReset()
  H.resume.mockReset()
  H.discardKept.mockReset()
})
afterEach(() => cleanup())

describe('a launch with no outcome after five minutes', () => {
  it('says it is waiting, does not claim the window failed, and frees the button', async () => {
    H.launch.mockResolvedValue({ ok: false, error: 'pending', late: new Promise(() => {}) })
    render(<WhatsappConnect {...base} />)
    await click()
    expect(screen.getByText(PENDING_TITLE)).toBeInTheDocument()
    expect(screen.queryByText(SDK_TITLE)).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toBeEnabled()
  })

  it('a late success clears the notice and refreshes the page', async () => {
    let finishLate!: (r: unknown) => void
    H.launch.mockResolvedValue({ ok: false, error: 'pending', late: new Promise((r) => { finishLate = r }) })
    render(<WhatsappConnect {...base} />)
    await click()
    await act(async () => { finishLate({ ok: true, messagingReady: true }) })
    expect(screen.queryByText(PENDING_TITLE)).not.toBeInTheDocument()
    expect(H.refresh).toHaveBeenCalledTimes(1)
  })

  it('a late Meta error replaces the notice with Meta’s words', async () => {
    let finishLate!: (r: unknown) => void
    H.launch.mockResolvedValue({ ok: false, error: 'pending', late: new Promise((r) => { finishLate = r }) })
    render(<WhatsappConnect {...base} />)
    await click()
    await act(async () => { finishLate({ ok: false, error: 'cancelled', cancel: { errorReported: true, errorMessage: 'Meta said no' } }) })
    expect(screen.queryByText(PENDING_TITLE)).not.toBeInTheDocument()
    expect(screen.getByText(/Meta said no/)).toBeInTheDocument()
  })

  it('a late outcome from an older click does not overwrite a newer one', async () => {
    let finishLate!: (r: unknown) => void
    H.launch.mockResolvedValueOnce({ ok: false, error: 'pending', late: new Promise((r) => { finishLate = r }) })
    H.launch.mockResolvedValueOnce({ ok: false, error: 'sdk' })
    render(<WhatsappConnect {...base} />)
    await click()
    await click()
    expect(screen.getByText(SDK_TITLE)).toBeInTheDocument()
    await act(async () => { finishLate({ ok: true }) })
    expect(screen.getByText(SDK_TITLE)).toBeInTheDocument()
    expect(H.refresh).not.toHaveBeenCalled()
  })
})

describe('a signup the server kept', () => {
  it('the next click finishes it without opening Meta’s window', async () => {
    H.launch.mockResolvedValueOnce({ ok: false, error: 'subscribe_incomplete', resumable: true })
    H.resume.mockResolvedValue({ ok: true })
    render(<WhatsappConnect {...base} />)
    await click()
    await click()
    expect(H.launch).toHaveBeenCalledTimes(1)
    expect(H.resume).toHaveBeenCalledTimes(1)
    expect(H.refresh).toHaveBeenCalledTimes(1)
  })

  it('kept from an earlier visit: same', async () => {
    H.resume.mockResolvedValue({ ok: true })
    render(<WhatsappConnect {...base} signupResumable />)
    await click()
    expect(H.launch).not.toHaveBeenCalled()
    expect(H.resume).toHaveBeenCalledTimes(1)
  })

  it('a resume that fails never blocks the customer from Meta’s flow', async () => {
    H.resume.mockResolvedValue({ ok: false, error: 'subscribe_incomplete', resumable: true })
    H.launch.mockResolvedValue({ ok: false, error: 'cancelled' })
    render(<WhatsappConnect {...base} signupResumable />)
    await click()
    await click()
    expect(H.resume).toHaveBeenCalledTimes(1)
    expect(H.launch).toHaveBeenCalledTimes(1)
    // Starting Meta's flow forgets the kept signup, so it cannot return after a cancel.
    expect(H.discardKept).toHaveBeenCalledTimes(1)
  })

  it('a resume that succeeded leaves nothing to forget', async () => {
    H.resume.mockResolvedValue({ ok: true })
    H.launch.mockResolvedValue({ ok: false, error: 'cancelled' })
    render(<WhatsappConnect {...base} signupResumable />)
    await click()
    await click()
    expect(H.discardKept).not.toHaveBeenCalled()
  })

  it('an ordinary launch with nothing kept makes no extra request', async () => {
    H.launch.mockResolvedValue({ ok: false, error: 'cancelled' })
    render(<WhatsappConnect {...base} />)
    await click()
    expect(H.discardKept).not.toHaveBeenCalled()
  })

  it('disconnecting forgets it: the next click opens Meta’s window', async () => {
    global.fetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch
    H.launch.mockResolvedValue({ ok: false, error: 'cancelled' })
    const { rerender } = render(<WhatsappConnect {...base} connection={{ phoneNumberId: 'P1' }} status='unknown' signupResumable />)
    await act(async () => { screen.getByRole('button', { name: /נתק וואטסאפ/ }).click() })
    await act(async () => { screen.getByRole('button', { name: CONFIRM }).click() })
    rerender(<WhatsappConnect {...base} />)
    await click()
    expect(H.resume).not.toHaveBeenCalled()
    expect(H.launch).toHaveBeenCalledTimes(1)
    expect(global.fetch).toHaveBeenCalledWith('/api/auth/whatsapp/disconnect', { method: 'POST' })
  })
})
