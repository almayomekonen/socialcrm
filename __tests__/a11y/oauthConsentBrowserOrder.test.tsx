// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import ConsentCard from '@/components/oauth/ConsentCard'

afterEach(cleanup)

const props = {
  clientName: 'Claude',
  redirectHost: 'claude.ai',
  userName: 'דנה',
  agencyName: 'סוכנות דנה',
  scopes: ['crm.leads.read', 'crm.conversations.read'] as ('crm.leads.read' | 'crm.conversations.read')[],
  csrf: 'c'.repeat(32),
}

/**
 * The REAL browser order for a native form submission:
 *   1. the submit event is dispatched and React's handler runs;
 *   2. the listener returns → microtask checkpoint → React commits the state
 *      update made in the handler (re-render);
 *   3. only THEN does the browser build the form data, with the submitter.
 * `await act(...)` around the dispatch reproduces step 2 before step 3.
 * Earlier tests built FormData inside the dispatch, i.e. before React's
 * commit, and could not see a re-render that changes the form.
 */
async function submitLikeABrowser(submitter: HTMLButtonElement) {
  const form = submitter.form as HTMLFormElement
  let sent = false
  const listener = (e: Event) => {
    sent = !e.defaultPrevented
    e.preventDefault() // jsdom cannot navigate
  }
  document.addEventListener('submit', listener)
  await act(async () => {
    const ev = new Event('submit', { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'submitter', { value: submitter })
    form.dispatchEvent(ev)
  })
  document.removeEventListener('submit', listener)
  return { sent, data: sent ? new FormData(form, submitter) : null }
}

describe('consent submission in browser order (form data built after React commits)', () => {
  it.each([
    ['אשר חיבור ל-Claude', 'approve'],
    ['ביטול', 'deny'],
  ])('%s sends exactly one decision=%s and the csrf', async (name, decision) => {
    render(<ConsentCard {...props} />)
    const { sent, data } = await submitLikeABrowser(screen.getByRole('button', { name }) as HTMLButtonElement)
    expect(sent).toBe(true)
    expect(data!.getAll('decision')).toEqual([decision])
    expect(data!.getAll('csrf')).toEqual(['c'.repeat(32)])
  })

  it('a second submission after the first is still blocked', async () => {
    render(<ConsentCard {...props} />)
    const approve = screen.getByRole('button', { name: 'אשר חיבור ל-Claude' }) as HTMLButtonElement
    expect((await submitLikeABrowser(approve)).sent).toBe(true)
    expect((await submitLikeABrowser(approve)).sent).toBe(false)
    const deny = screen.getByRole('button', { name: 'ביטול' }) as HTMLButtonElement
    expect((await submitLikeABrowser(deny)).sent).toBe(false)
  })
})
