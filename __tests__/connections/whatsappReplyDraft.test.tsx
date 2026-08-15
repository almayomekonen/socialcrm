// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { failureTextForCategory } from '@/lib/inbox/whatsappErrorCopy'

const sendWhatsappReply = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/actions/ai/whatsappReplyDraft', () => ({
  generateWhatsappReplyDraft: vi.fn(),
}))
vi.mock('@/actions/whatsapp/sendWhatsappReply', () => ({ sendWhatsappReply }))
vi.mock('@/lib/toast', () => ({ toast }))
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn() }))

import WhatsappReplyDraft from '@/components/summary/WhatsappReplyDraft'

afterEach(() => cleanup())
beforeEach(() => {
  sendWhatsappReply.mockReset()
  toast.mockReset()
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
