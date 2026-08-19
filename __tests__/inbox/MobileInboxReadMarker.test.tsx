// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { AwarenessProvider, useAwarenessCount } from '@/modules/inbox/awareness/AwarenessContext'

const H = vi.hoisted(() => ({
  markConversationRead: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: H.refresh, push: vi.fn() }),
  usePathname: () => '/inbox',
}))
vi.mock('@/modules/inbox/actions', () => ({
  markConversationRead: H.markConversationRead,
}))

import MobileInboxReadMarker from '@/modules/inbox/mobile/MobileInboxReadMarker'

function Badge() {
  const n = useAwarenessCount()
  return <span data-testid='conversations'>{n == null ? 'null' : String(n)}</span>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

beforeEach(() => {
  H.markConversationRead.mockReset()
  H.refresh.mockReset()
  H.markConversationRead.mockResolvedValue({ ok: true })
  document.body.setAttribute('data-mobile-workspace', '')
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ counts: { whatsappUnread: 2 }, items: [], serverTime: new Date().toISOString() }),
    }),
  )
})

describe('MobileInboxReadMarker', () => {
  it('marks the open thread read and moves the שיחות badge to the live unread count', async () => {
    const workspace = document.createElement('div')
    workspace.setAttribute('data-mobile-workspace', '')
    document.body.appendChild(workspace)

    render(
      <AwarenessProvider enabled={false} initialUnread={9}>
        <MobileInboxReadMarker conversationId={1170} latestMessageId={44} />
        <Badge />
      </AwarenessProvider>,
    )

    await waitFor(() => expect(H.markConversationRead).toHaveBeenCalledWith(1170))
    await waitFor(() => expect(document.querySelector('[data-testid="conversations"]')?.textContent).toBe('2'))
    expect(H.refresh).toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/inbox\/awareness\?since=/),
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('does not move the badge when mark-read fails', async () => {
    H.markConversationRead.mockResolvedValueOnce({ ok: false })
    render(
      <AwarenessProvider enabled={false} initialUnread={9}>
        <MobileInboxReadMarker conversationId={1} latestMessageId={null} />
        <Badge />
      </AwarenessProvider>,
    )
    await waitFor(() => expect(H.markConversationRead).toHaveBeenCalled())
    expect(document.querySelector('[data-testid="conversations"]')?.textContent).toBe('null')
    expect(H.refresh).not.toHaveBeenCalled()
  })
})
