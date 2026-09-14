// @vitest-environment jsdom
/**
 * Connect flows inside Instagram's in-app browser, and the not-completed
 * WhatsApp launch.
 *
 * Guarantees locked in:
 *   1. In Instagram's in-app browser the FIRST tap warns and does not open Meta.
 *   2. The next tap ("לנסות בכל זאת") opens Meta — a warning, never a gate.
 *   3. A normal browser — and Facebook's in-app browser, where production shows
 *      OAuth completing — opens Meta on the first tap, with no warning.
 *   4. A WhatsApp launch that ends `cancelled` with no connection explains it;
 *      on a live connection it stays silent, as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({
  launch: vi.fn(),
  run: vi.fn(),
  execute: true,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
vi.mock('@/lib/useAction', async () => {
  const { useState } = await import('react')
  return {
    useAction: () => {
      const [error, setError] = useState<string | null>(null)
      const run = async (fn: () => Promise<void>) => {
        H.run()
        if (!H.execute) return
        setError(null)
        await fn()
      }
      return { loading: false, error, setError, run }
    },
  }
})
vi.mock('@/lib/facebook/useEmbeddedSignup', () => ({
  useEmbeddedSignup: () => ({ launch: H.launch }),
}))

import WhatsappConnect from '@/components/settings/WhatsappConnect'
import FacebookConnect from '@/components/settings/FacebookConnect'

const IN_APP_TITLE = 'כדאי לפתוח את האתר בדפדפן'
const NOT_COMPLETED_TITLE = 'החיבור לוואטסאפ לא הושלם'
const wa = { pendingPhones: null, appId: 'a', configId: 'c', graphVersion: 'v19.0' as const }

const click = async (name: RegExp) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

beforeEach(() => {
  H.launch.mockReset()
  H.launch.mockResolvedValue({ ok: false, error: 'cancelled' })
  H.run.mockReset()
  H.execute = true
})
afterEach(() => cleanup())

describe('WhatsApp connect inside an in-app browser', () => {
  it('first tap warns without opening Meta; the next tap opens it', async () => {
    render(<WhatsappConnect {...wa} connection={null} status='disconnected' inAppBrowser='instagram' />)

    await click(/חבר וואטסאפ עסקי/)
    expect(H.launch).not.toHaveBeenCalled()
    expect(screen.getByText(IN_APP_TITLE)).toBeInTheDocument()

    await click(/לנסות בכל זאת/)
    expect(H.launch).toHaveBeenCalledTimes(1)
  })

  it('a normal browser opens Meta on the first tap, with no warning', async () => {
    render(<WhatsappConnect {...wa} connection={null} status='disconnected' inAppBrowser={null} />)
    await click(/חבר וואטסאפ עסקי/)
    expect(H.launch).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(IN_APP_TITLE)).not.toBeInTheDocument()
  })
})

describe('WhatsApp launch that ends cancelled', () => {
  it('with no connection → explains that the connection was not completed', async () => {
    render(<WhatsappConnect {...wa} connection={null} status='disconnected' />)
    await click(/חבר וואטסאפ עסקי/)
    expect(screen.getByText(NOT_COMPLETED_TITLE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /לנסות שוב/ })).toBeInTheDocument()
  })

  it('on a live connection → stays silent and keeps the health notice', async () => {
    render(<WhatsappConnect {...wa} connection={{ phoneNumberId: '1' }} status='token' />)
    await click(/לחבר מחדש/)
    expect(H.launch).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(NOT_COMPLETED_TITLE)).not.toBeInTheDocument()
    expect(screen.getByText('החיבור לוואטסאפ פג')).toBeInTheDocument()
  })

  it('other failures keep their existing notice', async () => {
    H.launch.mockResolvedValue({ ok: false, error: 'sdk' })
    render(<WhatsappConnect {...wa} connection={null} status='disconnected' />)
    await click(/חבר וואטסאפ עסקי/)
    expect(screen.getByText('חלון ההתחברות לא נפתח')).toBeInTheDocument()
  })
})

describe('Facebook connect inside an in-app browser', () => {
  const notConnected = { connection: null, pendingPages: null, health: null }

  beforeEach(() => {
    // `run` would navigate to /api/auth/facebook; record the attempt instead.
    H.execute = false
  })

  it('first tap warns without leaving for Meta; the next tap goes', async () => {
    render(<FacebookConnect {...notConnected} inAppBrowser='instagram' />)

    await click(/חבר חשבון פייסבוק/)
    expect(H.run).not.toHaveBeenCalled()
    expect(screen.getByText(IN_APP_TITLE)).toBeInTheDocument()

    await click(/לנסות בכל זאת/)
    expect(H.run).toHaveBeenCalledTimes(1)
  })

  it('a normal browser leaves for Meta on the first tap, with no warning', async () => {
    render(<FacebookConnect {...notConnected} inAppBrowser={null} />)
    await click(/חבר חשבון פייסבוק/)
    expect(H.run).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(IN_APP_TITLE)).not.toBeInTheDocument()
  })

  it("Facebook's own in-app browser is NOT warned — production shows OAuth completing there", async () => {
    render(<FacebookConnect {...notConnected} inAppBrowser='facebook' />)
    await click(/חבר חשבון פייסבוק/)
    expect(H.run).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(IN_APP_TITLE)).not.toBeInTheDocument()
  })
})
