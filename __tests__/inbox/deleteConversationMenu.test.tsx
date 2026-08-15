// @vitest-environment jsdom
//
// UI behavior for the "⋮ → מחק שיחה" menu. Pure client, no DB: VITEST_NO_DB=1.
// ConfirmPop (a portal/popover) is stubbed to a plain confirm/cancel pair so the
// test exercises the menu's decision logic, not the modal primitive's internals.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), selected: null as string | null }))
const store = vi.hoisted(() => ({ remove: vi.fn() }))
const action = vi.hoisted(() => ({
  impl: (async () => ({ ok: true, deleted: true })) as (id: number) => Promise<{ ok: boolean; deleted: boolean }>,
}))
const toastMock = vi.hoisted(() => ({ fn: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace, refresh: nav.refresh, push: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === 'conversation' ? nav.selected : null) }),
}))
vi.mock('@/modules/inbox/client/inboxStore', () => ({
  useInboxStore: () => ({ removeConversation: store.remove }),
}))
vi.mock('@/modules/inbox/actions', () => ({
  deleteConversation: (id: number) => action.impl(id),
}))
vi.mock('@/lib/toast', () => ({ toast: (...args: unknown[]) => toastMock.fn(...args) }))
vi.mock('@/lib/modals/ConfirmPop', () => ({
  default: ({ open, onConfirm, onClose, confirmLbl }: { open: boolean; onConfirm: () => void; onClose: () => void; confirmLbl: string }) =>
    open
      ? React.createElement(
          'div',
          { role: 'dialog' },
          React.createElement('button', { 'data-testid': 'confirm', onClick: onConfirm }, confirmLbl),
          React.createElement('button', { 'data-testid': 'cancel', onClick: onClose }, 'בטל'),
        )
      : null,
}))

import DeleteConversationMenu from '@/components/inbox/DeleteConversationMenu'

afterEach(cleanup)
beforeEach(() => {
  nav.replace.mockReset()
  nav.refresh.mockReset()
  nav.selected = null
  store.remove.mockReset()
  toastMock.fn.mockReset()
  action.impl = async () => ({ ok: true, deleted: true })
})

async function openAndConfirm(conversationId: number) {
  render(React.createElement(DeleteConversationMenu, { conversationId }))
  fireEvent.click(screen.getByLabelText('פעולות שיחה')) // open ⋮ menu
  fireEvent.click(screen.getByRole('menuitem', { name: /מחק שיחה/ })) // → confirm dialog
  await act(async () => {
    fireEvent.click(screen.getByTestId('confirm'))
  })
}

describe('DeleteConversationMenu', () => {
  it('success on a non-open row: deletes, removes from the list, does NOT navigate', async () => {
    nav.selected = null
    await openAndConfirm(42)
    expect(store.remove).toHaveBeenCalledWith(42)
    expect(nav.replace).not.toHaveBeenCalled()
    expect(nav.refresh).toHaveBeenCalled()
    expect(toastMock.fn).toHaveBeenCalledWith('success', expect.any(String))
  })

  it('success on the currently-open conversation: also closes it (navigates to /inbox)', async () => {
    nav.selected = '42' // this conversation is the open one
    await openAndConfirm(42)
    expect(store.remove).toHaveBeenCalledWith(42)
    expect(nav.replace).toHaveBeenCalledWith('/inbox')
  })

  it('server failure: leaves the UI untouched and shows an error toast (no removal, no nav)', async () => {
    action.impl = async () => ({ ok: false, deleted: false })
    await openAndConfirm(42)
    expect(store.remove).not.toHaveBeenCalled()
    expect(nav.replace).not.toHaveBeenCalled()
    expect(toastMock.fn).toHaveBeenCalledWith('error', expect.any(String))
  })

  it('thrown error: caught, no mutation, error toast', async () => {
    action.impl = async () => {
      throw new Error('network')
    }
    await openAndConfirm(42)
    expect(store.remove).not.toHaveBeenCalled()
    expect(toastMock.fn).toHaveBeenCalledWith('error', expect.any(String))
  })
})
