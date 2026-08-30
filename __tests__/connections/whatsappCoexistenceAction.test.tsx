// @vitest-environment jsdom
/**
 * The Coexistence transition action on an ALREADY-CONNECTED number.
 *
 * A healthy connection previously offered no route to Embedded Signup:
 * `canReconnect` covers only the broken states (unknown / token / webhook), so a
 * number still live in the WhatsApp Business app — `onboarding_type = 'cloud_api'`
 * while Graph reports `is_on_biz_app: true` — could reach Coexistence only by
 * DISCONNECTING, which destroys the stored token for no reason.
 *
 * These pin the narrow widening: the action appears for exactly that case, uses
 * the SAME `startEmbeddedSignup` the repair states use, and changes nothing else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({ actionError: null as string | null, launch: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
vi.mock('@/lib/useAction', () => ({
  useAction: () => ({ loading: false, error: H.actionError, setError: vi.fn(), run: (fn: () => unknown) => fn() }),
}))
vi.mock('@/lib/facebook/useEmbeddedSignup', () => ({
  useEmbeddedSignup: () => ({ launch: H.launch }),
}))

import WhatsappConnect from '@/components/settings/WhatsappConnect'

const PHONE_ID = '972007939322425'
const base = { pendingPhones: null, appId: 'a', configId: 'c', graphVersion: 'v19.0' as const }
const GREEN = 'החיבור תקין — לידים מגיעים אוטומטית'
const COEX = /סנכרן היסטוריית שיחות מהוואטסאפ/
const RECONNECT = /לחבר מחדש ולאמת/

beforeEach(() => {
  H.actionError = null
  H.launch = vi.fn(async () => ({ ok: false, error: 'cancelled' }))
})
afterEach(() => cleanup())

describe('Coexistence transition action', () => {
  it('operational + cloud_api + is_on_biz_app=true → the Coexistence action is offered', () => {
    render(
      <WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='operational' coexistenceAvailable />,
    )
    // Still healthy — the green claim is NOT replaced by a warning.
    expect(screen.getByText(GREEN)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: COEX })).toBeInTheDocument()
    // It is NOT labelled as a repair: nothing is broken.
    expect(screen.queryByRole('button', { name: RECONNECT })).not.toBeInTheDocument()
  })

  it('it launches the SAME Embedded Signup flow — no new path', () => {
    render(
      <WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='operational' coexistenceAvailable />,
    )
    screen.getByRole('button', { name: COEX }).click()
    expect(H.launch).toHaveBeenCalledTimes(1)
  })

  it('operational + already coexistence → no action, so no duplicate history sync', () => {
    // The server passes coexistenceAvailable=false once onboarding_type is
    // 'coexistence'. Even if the flow were re-run, the route's `alreadySynced`
    // guard skips syncSmbAppData — this is the outer of the two defences.
    render(
      <WhatsappConnect
        {...base}
        connection={{ phoneNumberId: PHONE_ID }}
        status='operational'
        coexistenceAvailable={false}
      />,
    )
    expect(screen.getByText(GREEN)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: COEX })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: RECONNECT })).not.toBeInTheDocument()
  })

  it('operational + cloud_api + is_on_biz_app=false → unchanged; no action offered', () => {
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='operational' />)
    expect(screen.getByText(GREEN)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: COEX })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: RECONNECT })).not.toBeInTheDocument()
  })

  it('the prop DEFAULTS to false — every existing caller renders as before', () => {
    // Mobile surfaces pass no such prop; omitting it must change nothing.
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='operational' />)
    expect(screen.queryByRole('button', { name: COEX })).not.toBeInTheDocument()
  })
})

describe('existing reconnect behaviour is unchanged', () => {
  it.each(['unknown', 'token', 'webhook'] as const)('%s → repair action still offered, with its own label', (status) => {
    render(<WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status={status} />)
    expect(screen.queryByText(GREEN)).not.toBeInTheDocument()
    // The repair label wins even when coexistence is also available.
    expect(screen.queryByRole('button', { name: COEX })).not.toBeInTheDocument()
  })

  it('a broken state keeps its repair label even if coexistenceAvailable is true', () => {
    render(
      <WhatsappConnect {...base} connection={{ phoneNumberId: PHONE_ID }} status='unknown' coexistenceAvailable />,
    )
    expect(screen.getByRole('button', { name: RECONNECT })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: COEX })).not.toBeInTheDocument()
  })

  it('registration_pending → still no launch action at all', () => {
    render(
      <WhatsappConnect
        {...base}
        connection={{ phoneNumberId: PHONE_ID }}
        status='registration_pending'
        coexistenceAvailable
      />,
    )
    expect(screen.queryByRole('button', { name: COEX })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: RECONNECT })).not.toBeInTheDocument()
  })
})
