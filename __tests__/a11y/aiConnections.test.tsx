// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const H = vi.hoisted(() => ({ disconnect: vi.fn(), toast: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/oauthGrants', () => ({ disconnectAiConnection: H.disconnect }))
vi.mock('@/lib/toast', () => ({ toast: H.toast }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: H.refresh, push: vi.fn() }) }))

import AiConnections from '@/components/settings/AiConnections'
import type { AiConnectionView } from '@/lib/oauth/server/connections'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const conn = (grantId: number, clientLabel: string): AiConnectionView => ({
  grantId,
  clientLabel,
  scopeLabels: ['צפייה בלידים שלך, במעקבים ובסיכום היומי', 'צפייה בסיכומי שיחות WhatsApp עם הלידים שלך, ובהודעות עצמן לפי בקשה'],
  connectedOn: '4.10.2026',
  lastUsedOn: null,
})

describe('AiConnections', () => {
  it('is vendor-neutral: an h3 "חיבורי AI", never a ChatGPT-only heading', () => {
    render(<AiConnections connections={[]} />)
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('חיבורי AI')
  })

  it('empty: says not connected and where the connection starts; no button', () => {
    render(<AiConnections connections={[]} />)
    expect(screen.getByText('לא מחובר')).toBeInTheDocument()
    expect(screen.getByText('החיבור מתבצע מתוך Claude או ChatGPT')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lists each connection with its own labelled disconnect button and Hebrew scope labels', () => {
    render(<AiConnections connections={[conn(1, 'Claude'), conn(2, 'ChatGPT')]} />)
    expect(screen.getByRole('button', { name: 'נתק את Claude' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'נתק את ChatGPT' })).toBeInTheDocument()
    expect(screen.getAllByText('צפייה בלידים שלך, במעקבים ובסיכום היומי')).toHaveLength(2)
    expect(screen.getAllByText(/מחובר מאז 4\.10\.2026 · שימוש אחרון —/)).toHaveLength(2)
    expect(document.body.textContent).not.toMatch(/crm\.(leads|conversations)\.read/)
  })

  it('disconnect asks first, names the app and the consequence, then disconnects only that grant', async () => {
    H.disconnect.mockResolvedValue({ ok: true })
    render(<AiConnections connections={[conn(1, 'Claude'), conn(2, 'ChatGPT')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'נתק את Claude' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Claude לא יוכל עוד לקרוא את הלידים והשיחות שלך.')
    expect(H.disconnect).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'נתק את Claude' }))
    await waitFor(() => expect(H.disconnect).toHaveBeenCalledWith(1))
    expect(H.disconnect).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(H.toast).toHaveBeenCalledWith('success', 'Claude נותק'))
    expect(H.refresh).toHaveBeenCalled()
  })

  it('a failed disconnect shows an error toast', async () => {
    H.disconnect.mockResolvedValue({ ok: false, msg: 'x' })
    render(<AiConnections connections={[conn(7, 'ChatGPT')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'נתק את ChatGPT' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'נתק את ChatGPT' }))
    await waitFor(() => expect(H.toast).toHaveBeenCalledWith('error', 'הניתוק נכשל. נסה שוב.'))
  })
})
