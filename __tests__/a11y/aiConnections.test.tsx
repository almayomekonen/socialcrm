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

  it('empty: says not connected yet and where the connection starts; no button while closed', () => {
    render(<AiConnections connections={[]} mcpUrl='https://getsocialcrm.com/api/mcp' />)
    expect(screen.getByText('לא מחובר עדיין')).toBeInTheDocument()
    expect(screen.getByText('החיבור מתחיל מתוך Claude או ChatGPT.')).toBeInTheDocument()
    expect(screen.getByText('חברו את SocialCRM ל-Claude או ChatGPT כדי לשאול על לידים, מעקבים ושיחות.')).toBeInTheDocument()
    expect(screen.getByText('הגישה מוגבלת לנתונים שאתם מורשים לראות. מספרי טלפון ואימיילים אינם נשלחים.')).toBeInTheDocument()
    // The only button (copy) lives inside the closed disclosure, which browsers
    // hide until it is opened; there is no connect/disconnect button.
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['העתקה'])
    expect(buttons[0].closest('details')).not.toHaveAttribute('open')
  })

  it('"איך מתחברים?" is a closed native disclosure with the four steps and the MCP URL', () => {
    const { container } = render(<AiConnections connections={[]} mcpUrl='https://getsocialcrm.com/api/mcp' />)
    const details = container.querySelector('details')!
    expect(details).not.toHaveAttribute('open')
    const summary = details.querySelector('summary')!
    expect(summary).toHaveTextContent('איך מתחברים?')
    fireEvent.click(summary)
    details.open = true
    const steps = within(details).getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    expect(steps[0]).toHaveTextContent('פותחים את Claude או ChatGPT')
    expect(steps[1]).toHaveTextContent('מוסיפים חיבור MCP חדש')
    expect(steps[2]).toHaveTextContent('מזינים:')
    expect(within(steps[2]).getByText('https://getsocialcrm.com/api/mcp')).toHaveAttribute('dir', 'ltr')
    expect(steps[3]).toHaveTextContent('מתחברים ל-SocialCRM ומאשרים הרשאה')
  })

  it('the copy button copies the exact MCP URL and confirms', () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { container } = render(<AiConnections connections={[]} mcpUrl='https://getsocialcrm.com/api/mcp' />)
    container.querySelector('details')!.open = true
    fireEvent.click(screen.getByRole('button', { name: 'העתקה' }))
    expect(writeText).toHaveBeenCalledWith('https://getsocialcrm.com/api/mcp')
    expect(H.toast).toHaveBeenCalledWith('success', 'הועתק')
  })

  it('without a configured URL the step still reads correctly and nothing breaks', () => {
    const { container } = render(<AiConnections connections={[]} />)
    expect(container.querySelector('details')).toHaveTextContent('מזינים את כתובת החיבור של SocialCRM')
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
