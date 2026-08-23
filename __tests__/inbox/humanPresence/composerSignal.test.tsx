// @vitest-environment jsdom
//
// WhatsApp Agent — the composer side of Human Presence.
//
// The two behaviours a rep experiences, proven against the real composers:
//   · opening and reading a conversation does NOT stop the agent;
//   · the FIRST keystroke does, immediately — no debounce, no grace period.
//
// Runs without a database (VITEST_NO_DB=1).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const H = vi.hoisted(() => ({
  signalHumanTyping: vi.fn(async () => ({ ok: true })),
  sendWhatsappReply: vi.fn(async () => ({ ok: true as const })),
  generateWhatsappReplyDraft: vi.fn(async () => ({ ok: false as const })),
  markConversationRead: vi.fn(async () => ({ ok: true })),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, back: () => {}, refresh: () => {} }),
  usePathname: () => '/inbox',
}))
vi.mock('@/modules/inbox/actions', () => ({
  signalHumanTyping: H.signalHumanTyping,
  markConversationRead: H.markConversationRead,
}))
vi.mock('@/actions/whatsapp/sendWhatsappReply', () => ({ sendWhatsappReply: H.sendWhatsappReply }))
vi.mock('@/actions/ai/whatsappReplyDraft', () => ({ generateWhatsappReplyDraft: H.generateWhatsappReplyDraft }))
vi.mock('@/lib/toast', () => ({ toast: vi.fn() }))
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }))

import WhatsappReplyDraft from '@/components/summary/WhatsappReplyDraft'
import InboxReadMarker from '@/modules/inbox/components/InboxReadMarker'
import { useComposerTypingSignal } from '@/modules/inbox/client/useComposerTypingSignal'
import { HUMAN_TYPING_REFRESH_MS } from '@/lib/inbox/autoresponse/humanPresence'

vi.mock('@/modules/inbox/client/inboxStore', () => ({
  useInboxStore: () => ({ applyLocalRead: () => {}, activeConversationId: null, activeLatestMessageId: null }),
}))

const CONVERSATION_ID = 382

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
beforeEach(() => {
  H.signalHumanTyping.mockClear()
})

describe('opening a conversation does not stop the agent', () => {
  it('rendering the composer sends no typing signal', () => {
    render(<WhatsappReplyDraft leadId={1417} conversationId={CONVERSATION_ID} />)
    expect(H.signalHumanTyping).not.toHaveBeenCalled()
  })

  it('focusing the composer without typing sends no signal', () => {
    render(<WhatsappReplyDraft leadId={1417} conversationId={CONVERSATION_ID} />)
    fireEvent.focus(screen.getByLabelText('טיוטת תשובה בוואטסאפ'))
    expect(H.signalHumanTyping).not.toHaveBeenCalled()
  })

  it('marking the thread READ sends no typing signal', async () => {
    // Reading is the single most common thing a rep does. If it parked the agent,
    // the agent would be useless exactly when the inbox is busiest.
    render(<InboxReadMarker conversationId={CONVERSATION_ID} latestMessageId={99} />)
    await waitFor(() => expect(H.markConversationRead).toHaveBeenCalled())
    expect(H.signalHumanTyping).not.toHaveBeenCalled()
  })
})

describe('typing stops the agent immediately', () => {
  it('the FIRST character signals, with no debounce', () => {
    render(<WhatsappReplyDraft leadId={1417} conversationId={CONVERSATION_ID} />)
    fireEvent.change(screen.getByLabelText('טיוטת תשובה בוואטסאפ'), { target: { value: 'ש' } })
    expect(H.signalHumanTyping).toHaveBeenCalledTimes(1)
    expect(H.signalHumanTyping).toHaveBeenCalledWith(CONVERSATION_ID)
  })

  it('pasting a whole reply signals as well', () => {
    render(<WhatsappReplyDraft leadId={1417} conversationId={CONVERSATION_ID} />)
    fireEvent.change(screen.getByLabelText('טיוטת תשובה בוואטסאפ'), {
      target: { value: 'שלום, אני חוזר אליך עוד מעט' },
    })
    expect(H.signalHumanTyping).toHaveBeenCalledTimes(1)
  })

  it('a burst of keystrokes is throttled to one heartbeat', () => {
    // Presence must be cheap enough that nobody is ever tempted to debounce the
    // first keystroke to save writes.
    render(<WhatsappReplyDraft leadId={1417} conversationId={CONVERSATION_ID} />)
    const box = screen.getByLabelText('טיוטת תשובה בוואטסאפ')
    for (const value of ['ש', 'של', 'שלו', 'שלום', 'שלום ', 'שלום ל']) {
      fireEvent.change(box, { target: { value } })
    }
    expect(H.signalHumanTyping).toHaveBeenCalledTimes(1)
  })

  it('a composer with no conversation id signals nothing', () => {
    render(<WhatsappReplyDraft leadId={1417} conversationId={null} />)
    fireEvent.change(screen.getByLabelText('טיוטת תשובה בוואטסאפ'), { target: { value: 'x' } })
    expect(H.signalHumanTyping).not.toHaveBeenCalled()
  })
})

// ── The hook itself, where timing and multi-tab behaviour are observable ──────
function Harness({ conversationId, send }: { conversationId: number | null; send: (id: number) => Promise<unknown> }) {
  const signal = useComposerTypingSignal(conversationId, { send })
  return <button onClick={signal}>type</button>
}

describe('the typing heartbeat', () => {
  it('refreshes once the throttle window has passed', () => {
    vi.useFakeTimers()
    try {
      const send = vi.fn(async () => ({ ok: true }))
      render(<Harness conversationId={CONVERSATION_ID} send={send} />)
      const key = screen.getByText('type')
      fireEvent.click(key)
      fireEvent.click(key)
      expect(send).toHaveBeenCalledTimes(1)

      vi.setSystemTime(Date.now() + HUMAN_TYPING_REFRESH_MS + 1)
      fireEvent.click(key)
      expect(send).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a failed heartbeat is retried on the next keystroke, not swallowed for the window', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true })
    render(<Harness conversationId={CONVERSATION_ID} send={send} />)
    const key = screen.getByText('type')
    fireEvent.click(key)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    fireEvent.click(key)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  })

  it('switching conversations does not swallow the first keystroke in the new one', () => {
    const send = vi.fn(async () => ({ ok: true }))
    const { rerender } = render(<Harness conversationId={CONVERSATION_ID} send={send} />)
    fireEvent.click(screen.getByText('type'))
    expect(send).toHaveBeenCalledWith(CONVERSATION_ID)

    rerender(<Harness conversationId={999} send={send} />)
    fireEvent.click(screen.getByText('type'))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith(999)
  })

  it('MULTIPLE TABS: each tab heartbeats independently on the same conversation', () => {
    // Two tabs are two hook instances with separate throttles. Both write; the
    // server takes the newest beat and the furthest expiry, so neither tab can
    // shorten the other's window.
    const send = vi.fn(async () => ({ ok: true }))
    render(
      <>
        <Harness conversationId={CONVERSATION_ID} send={send} />
        <Harness conversationId={CONVERSATION_ID} send={send} />
      </>,
    )
    const [tabA, tabB] = screen.getAllByText('type')
    fireEvent.click(tabA)
    fireEvent.click(tabB)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(1, CONVERSATION_ID)
    expect(send).toHaveBeenNthCalledWith(2, CONVERSATION_ID)
  })
})
