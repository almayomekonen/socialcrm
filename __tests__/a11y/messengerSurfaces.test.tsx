// @vitest-environment jsdom
/**
 * Accessibility for the Messenger surfaces.
 *
 * Extends the frozen a11y baseline (release-deployment-workflow §9) to cover UI
 * this branch adds: the composer's icon-only controls, the saved-reply picker,
 * the unread badge, the upload tray and the delivery state.
 *
 * The recurring rules here: an icon-only control must have a name, colour must
 * never be the only carrier of meaning, and a progress bar must not announce a
 * number it does not know.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/inbox/messenger',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/useAction', () => ({
  useAction: () => ({ loading: false, error: null, setError: vi.fn(), run: (fn: () => unknown) => fn(), accessDenied: false }),
}))
vi.mock('@/modules/messenger/actions', () => ({
  sendMessengerReply: vi.fn(async () => ({ ok: true })),
  sendMessengerSavedReply: vi.fn(async () => ({ ok: true })),
  sendMessengerTyping: vi.fn(async () => ({ ok: true })),
  markMessengerConversationRead: vi.fn(async () => ({ ok: true })),
  loadOlderMessengerMessages: vi.fn(),
}))

import MessengerComposer from '@/modules/messenger/components/MessengerComposer'
import MessengerSavedReplyPicker from '@/modules/messenger/components/MessengerSavedReplyPicker'
import MessengerAttachmentTray from '@/modules/messenger/components/MessengerAttachmentTray'
import MessengerMessageStatus from '@/modules/messenger/components/MessengerMessageStatus'
import MessengerAvatar from '@/modules/messenger/components/MessengerAvatar'
import MessengerSearch from '@/modules/messenger/components/MessengerSearch'
import InboxChannelSwitch from '@/modules/inbox/components/InboxChannelSwitch'
import type { MessengerSavedReply } from '@/db/messengerSavedReplies'
import type { MessengerMessage } from '@/modules/messenger/types'

afterEach(cleanup)

const reply = (over: Partial<MessengerSavedReply> = {}): MessengerSavedReply => ({
  id: 1,
  title: 'שעות פעילות',
  body: 'א׳-ה׳ 9:00-17:00',
  quickReplies: [],
  buttons: [],
  attachmentUrl: null,
  attachmentType: null,
  ...over,
})

const message = (over: Partial<MessengerMessage> = {}): MessengerMessage => ({
  id: 1,
  direction: 'outbound',
  source: 'socialcrm',
  text: 'שלום',
  attachments: [],
  timestamp: new Date('2026-09-20T10:00:00Z'),
  deliveredAt: null,
  readAt: null,
  ...over,
})

describe('composer controls', () => {
  it('every icon-only control has an accessible name', () => {
    render(<MessengerComposer conversationId={1} windowOpen windowHint={null} savedReplies={[reply()]} />)
    expect(screen.getByRole('button', { name: 'צרף קובץ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'תשובות שמורות' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'שלח הודעה' })).toBeInTheDocument()
  })

  it('the message box is labelled, and relabelled when a file is attached', () => {
    render(<MessengerComposer conversationId={1} windowOpen windowHint={null} />)
    expect(screen.getByLabelText('תשובה ב-Messenger')).toBeInTheDocument()

    const input = document.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } })
    expect(screen.getByLabelText('כיתוב לקובץ (לא חובה)')).toBeInTheDocument()
  })

  it('the window-closed state is a status region, not a silent disabled box', () => {
    render(<MessengerComposer conversationId={1} windowOpen={false} windowHint={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('חלון המענה נסגר')
  })

  it('a send failure is announced as an alert and linked to the field', () => {
    render(<MessengerComposer conversationId={1} windowOpen windowHint={null} />)
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    const big = new File(['x'], 'huge.mp4', { type: 'video/mp4' })
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [big] } })
    fireEvent.click(screen.getByRole('button', { name: 'שלח הודעה' }))

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(screen.getByLabelText('כיתוב לקובץ (לא חובה)')).toHaveAttribute('aria-describedby', alert.id)
  })
})

describe('saved reply picker', () => {
  it('is a listbox whose options are reachable and selectable by keyboard', () => {
    const onInsert = vi.fn()
    render(
      <MessengerSavedReplyPicker
        replies={[reply({ id: 1, title: 'ראשונה' }), reply({ id: 2, title: 'שנייה' })]}
        onInsert={onInsert}
        onSend={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'תשובות שמורות' }))

    const list = screen.getByRole('listbox', { name: 'תשובות שמורות' })
    expect(screen.getAllByRole('option')).toHaveLength(2)
    // The active option is exposed, not merely styled.
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onInsert).toHaveBeenCalledWith(expect.objectContaining({ title: 'שנייה' }))
  })

  it('Escape closes it and returns focus to the trigger', () => {
    render(<MessengerSavedReplyPicker replies={[reply()]} onInsert={vi.fn()} onSend={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'תשובות שמורות' })
    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('the trigger reports its expanded state', () => {
    render(<MessengerSavedReplyPicker replies={[reply()]} onInsert={vi.fn()} onSend={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'תשובות שמורות' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('renders nothing at all when the agency has no saved replies', () => {
    const { container } = render(<MessengerSavedReplyPicker replies={[]} onInsert={vi.fn()} onSend={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('upload progress', () => {
  const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' })

  it('does not announce a percentage it does not know', () => {
    render(<MessengerAttachmentTray file={file} upload={{ phase: 'uploading', progress: null }} onRemove={vi.fn()} />)
    const bar = screen.getByRole('progressbar', { name: 'התקדמות העלאה' })
    // Indeterminate: aria-valuenow is absent rather than a misleading 0.
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByRole('status')).toHaveTextContent('מעלה…')
  })

  it('announces a real percentage once the browser reports bytes', () => {
    render(<MessengerAttachmentTray file={file} upload={{ phase: 'uploading', progress: 42 }} onRemove={vi.fn()} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByRole('status')).toHaveTextContent('42%')
  })

  it('names the remove control differently while an upload is in flight', () => {
    const { rerender } = render(
      <MessengerAttachmentTray file={file} upload={{ phase: 'idle' }} onRemove={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'הסר את הקובץ' })).toBeInTheDocument()
    rerender(<MessengerAttachmentTray file={file} upload={{ phase: 'sending' }} onRemove={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'בטל את העלאת הקובץ' })).toBeInTheDocument()
  })
})

describe('meaning is never carried by colour alone', () => {
  it('delivery state has a text label behind the tick icon', () => {
    const { rerender } = render(<MessengerMessageStatus message={message()} />)
    expect(screen.getByText('נשלח — ממתין לאישור מסירה')).toBeInTheDocument()

    rerender(<MessengerMessageStatus message={message({ deliveredAt: new Date() })} />)
    expect(screen.getByText('נמסר')).toBeInTheDocument()

    rerender(<MessengerMessageStatus message={message({ deliveredAt: new Date(), readAt: new Date() })} />)
    expect(screen.getByText('נקרא')).toBeInTheDocument()
  })

  it('the unread badge states the count in its accessible name', () => {
    render(<InboxChannelSwitch active='whatsapp' showMessenger messengerUnread={3} />)
    expect(screen.getByLabelText('3 שיחות שלא נקראו')).toHaveTextContent('3')
  })

  it('a zero unread count renders no badge at all', () => {
    render(<InboxChannelSwitch active='whatsapp' showMessenger messengerUnread={0} />)
    expect(screen.queryByLabelText(/שלא נקראו/)).not.toBeInTheDocument()
  })
})

describe('avatar and search', () => {
  it('the avatar is decorative — the name is already the row text, so it is not announced twice', () => {
    const { container } = render(<MessengerAvatar name='דנה לוי' picUrl='https://cdn.example/p.jpg' />)
    const img = container.querySelector('img')!
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('aria-hidden', 'true')
  })

  it('search has a label and a named clear control', () => {
    render(<MessengerSearch initial='דנה' />)
    expect(screen.getByLabelText('חיפוש בשיחות Messenger')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'נקה חיפוש' })).toBeInTheDocument()
  })
})

describe('no emoji in Messenger chrome', () => {
  it('the composer and picker contain none', () => {
    const { container } = render(
      <MessengerComposer conversationId={1} windowOpen windowHint='אפשר להשיב עוד כ-20 שעות' savedReplies={[reply()]} />,
    )
    // Pictographs only; Hebrew, punctuation and the ellipsis are fine.
    expect(container.textContent ?? '').not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
