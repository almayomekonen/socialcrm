// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { failureTextForCategory } from '@/lib/inbox/whatsappErrorCopy'

const sendWhatsappReply = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => vi.fn())
const generateWhatsappReplyDraft = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/actions/ai/whatsappReplyDraft', () => ({ generateWhatsappReplyDraft }))
vi.mock('@/actions/whatsapp/sendWhatsappReply', () => ({ sendWhatsappReply }))
vi.mock('@/lib/toast', () => ({ toast }))
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn() }))

import WhatsappReplyDraft from '@/components/summary/WhatsappReplyDraft'

afterEach(() => cleanup())
beforeEach(() => {
  sendWhatsappReply.mockReset()
  toast.mockReset()
  generateWhatsappReplyDraft.mockReset()
})

describe('WhatsappReplyDraft — send category copy', () => {
  it('shows the existing Hebrew account copy for category account', async () => {
    sendWhatsappReply.mockResolvedValue({ ok: false, reason: 'send-failed', category: 'account' })
    render(<WhatsappReplyDraft leadId={9} />)
    fireEvent.change(screen.getByLabelText('טיוטת תשובה בוואטסאפ'), { target: { value: 'שלום' } })
    fireEvent.click(screen.getByLabelText('שלח הודעה'))
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('error', failureTextForCategory('account'))
    })
  })
})

describe('WhatsappReplyDraft — metered AI draft', () => {
  const press = () => fireEvent.click(screen.getByTitle('נסח טיוטה עם AI'))

  it('a page load generates nothing', () => {
    render(<WhatsappReplyDraft leadId={9} />)
    expect(generateWhatsappReplyDraft).not.toHaveBeenCalled()
  })

  it('a double press is one request', async () => {
    let finish: (v: unknown) => void = () => undefined
    generateWhatsappReplyDraft.mockReturnValue(new Promise((r) => (finish = r)))
    render(<WhatsappReplyDraft leadId={9} />)
    const button = screen.getByTitle('נסח טיוטה עם AI')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(generateWhatsappReplyDraft).toHaveBeenCalledTimes(1)
    finish({ ok: true, message: 'שלום' })
    await waitFor(() => expect(screen.getByLabelText('טיוטת תשובה בוואטסאפ')).toHaveValue('שלום'))
  })

  it('each new press carries its own id', async () => {
    generateWhatsappReplyDraft.mockResolvedValue({ ok: true, message: 'שלום' })
    render(<WhatsappReplyDraft leadId={9} />)
    press()
    await waitFor(() => expect(screen.getByLabelText('טיוטת תשובה בוואטסאפ')).toHaveValue('שלום'))
    press()
    await waitFor(() => expect(generateWhatsappReplyDraft).toHaveBeenCalledTimes(2))
    const [a, b] = generateWhatsappReplyDraft.mock.calls
    expect(a[1]).not.toBe(b[1])
  })

  it('an exhausted allowance says so, instead of inviting a retry', async () => {
    generateWhatsappReplyDraft.mockResolvedValue({ ok: false, reason: 'ai-credits-exhausted' })
    render(<WhatsappReplyDraft leadId={9} />)
    press()
    expect(await screen.findByText(/נוצלו הבקשות הכלולות החודש/)).toBeInTheDocument()
    expect(screen.queryByText(/נסה שוב/)).toBeNull()
  })

  it('a failed draft invites a retry', async () => {
    generateWhatsappReplyDraft.mockResolvedValue({ ok: false, reason: 'ai-failed' })
    render(<WhatsappReplyDraft leadId={9} />)
    press()
    expect(await screen.findByText(/נסה שוב/)).toBeInTheDocument()
  })
})
