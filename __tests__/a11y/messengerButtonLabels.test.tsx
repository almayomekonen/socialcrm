// @vitest-environment jsdom
/**
 * Messenger buttons must render their visible, named labels.
 *
 * Regression: these components passed button text as JSX children, which `Btn`
 * discards (it renders only `lbl`/`icon`). In the saved-replies form the save
 * button shipped as an empty purple square and cancel / "add quick reply" /
 * "add button" / edit were invisible, so quick replies and link buttons could
 * not be added at all. The entry-points save button and the inbox's
 * import-history button were empty boxes for the same reason.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/lib/useAction', () => ({
  useAction: () => ({ loading: false, error: null, setError: vi.fn(), run: (fn: () => unknown) => fn(), accessDenied: false }),
}))
vi.mock('@/modules/messenger/savedReplyActions', () => ({
  createSavedReply: vi.fn(),
  updateSavedReply: vi.fn(),
  deleteSavedReply: vi.fn(),
}))
vi.mock('@/modules/messenger/profileActions', () => ({
  updateMessengerProfile: vi.fn(),
  importMessengerConversations: vi.fn(),
}))

import MessengerSavedReplies from '@/components/settings/messenger/MessengerSavedReplies'
import MessengerEntryPoints from '@/components/settings/messenger/MessengerEntryPoints'
import MessengerImportHistory from '@/modules/messenger/components/MessengerImportHistory'
import type { MessengerSavedReply } from '@/db/messengerSavedReplies'

afterEach(cleanup)

const reply: MessengerSavedReply = {
  id: 1,
  title: 'שעות פעילות',
  body: 'א׳-ה׳ 9:00-17:00',
  quickReplies: [],
  buttons: [],
  attachmentUrl: null,
  attachmentType: null,
}

describe('saved replies settings buttons', () => {
  it('the list and add controls show their labels', () => {
    render(<MessengerSavedReplies initial={[reply]} />)
    expect(screen.getByRole('button', { name: 'ערוך את שעות פעילות' })).toHaveTextContent('ערוך')
    expect(screen.getByRole('button', { name: 'הוסף תשובה שמורה' })).toHaveTextContent('הוסף תשובה שמורה')
  })

  it('the open form shows save, cancel and both add controls with their labels', () => {
    render(<MessengerSavedReplies initial={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'הוסף תשובה שמורה' }))

    for (const name of ['שמור תשובה שמורה', 'ביטול', 'הוסף תשובה מהירה', 'הוסף כפתור']) {
      expect(screen.getByRole('button', { name })).toHaveTextContent(name)
    }
  })

  it('the add controls still add a field', () => {
    render(<MessengerSavedReplies initial={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'הוסף תשובה שמורה' }))
    fireEvent.click(screen.getByRole('button', { name: 'הוסף תשובה מהירה' }))
    fireEvent.click(screen.getByRole('button', { name: 'הוסף כפתור' }))

    expect(screen.getByLabelText('תשובה מהירה 1')).toBeInTheDocument()
    expect(screen.getByLabelText('טקסט כפתור 1')).toBeInTheDocument()
    expect(screen.getByLabelText('כתובת כפתור 1')).toBeInTheDocument()
  })
})

describe('other Messenger buttons', () => {
  it('the entry-points save button shows its label', () => {
    render(
      <MessengerEntryPoints
        pageId='1'
        initial={{ greeting: '', getStartedPayload: '', menuItems: [], composerInputDisabled: false }}
        readFailed={false}
      />,
    )
    expect(screen.getByRole('button', { name: 'שמור שינויים' })).toHaveTextContent('שמור שינויים')
  })

  it('the import-history button shows its label', () => {
    render(<MessengerImportHistory pageId='1' />)
    expect(screen.getByRole('button', { name: 'ייבא שיחות קיימות מהדף' })).toHaveTextContent('ייבא שיחות קיימות מהדף')
  })
})
