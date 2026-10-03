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
 * Records which submit events would actually be SENT (not prevented by the
 * component), and stops jsdom's unimplemented navigation. The document-level
 * listener runs after React's root listener, so it sees React's decision.
 */
function recordSubmissions() {
  const sent: { decision: string; csrf: string }[] = []
  const listener = (e: Event) => {
    if (!e.defaultPrevented) {
      const form = e.target as HTMLFormElement
      const data = new FormData(form)
      sent.push({ decision: String(data.get('decision')), csrf: String(data.get('csrf')) })
    }
    e.preventDefault()
  }
  document.addEventListener('submit', listener)
  return { sent, stop: () => document.removeEventListener('submit', listener) }
}

/** A real SubmitEvent dispatched synchronously — no render happens between two calls. */
function submit(form: HTMLFormElement, submitter: HTMLElement | null) {
  const ev = new Event('submit', { bubbles: true, cancelable: true })
  Object.defineProperty(ev, 'submitter', { value: submitter })
  form.dispatchEvent(ev)
}

const parts = () => {
  const form = document.querySelector('form') as HTMLFormElement
  return {
    form,
    approve: screen.getByRole('button', { name: 'אשר חיבור ל-Claude' }),
    deny: screen.getByRole('button', { name: 'ביטול' }),
  }
}

describe('consent form — single submission', () => {
  it('the first Approve is sent with the correct decision and csrf; an immediate second Approve is blocked', () => {
    render(<ConsentCard {...props} />)
    const { form, approve } = parts()
    const rec = recordSubmissions()
    act(() => {
      submit(form, approve)
      submit(form, approve)
    })
    rec.stop()
    expect(rec.sent).toEqual([{ decision: 'approve', csrf: 'c'.repeat(32) }])
  })

  it('Approve then an immediate Deny is blocked', () => {
    render(<ConsentCard {...props} />)
    const { form, approve, deny } = parts()
    const rec = recordSubmissions()
    act(() => {
      submit(form, approve)
      submit(form, deny)
    })
    rec.stop()
    expect(rec.sent).toEqual([{ decision: 'approve', csrf: 'c'.repeat(32) }])
  })

  it('Deny then an immediate Approve is blocked', () => {
    render(<ConsentCard {...props} />)
    const { form, approve, deny } = parts()
    const rec = recordSubmissions()
    act(() => {
      submit(form, deny)
      submit(form, approve)
    })
    rec.stop()
    expect(rec.sent).toEqual([{ decision: 'deny', csrf: 'c'.repeat(32) }])
  })

  it('a submit with no recognised submitter (implicit submission) sends nothing and does not lock', () => {
    render(<ConsentCard {...props} />)
    const { form, approve } = parts()
    const rec = recordSubmissions()
    act(() => {
      submit(form, null)
      submit(form, approve)
    })
    rec.stop()
    expect(rec.sent).toEqual([{ decision: 'approve', csrf: 'c'.repeat(32) }])
  })

  it('keyboard activation (Enter/Space → click on the focused button) cannot send twice', () => {
    render(<ConsentCard {...props} />)
    const { form, approve } = parts()
    approve.focus()
    expect(approve).toHaveFocus()
    const rec = recordSubmissions()
    act(() => {
      // A keyboard activation is a synthetic click → submit with this submitter.
      submit(form, approve)
      submit(form, approve)
      submit(form, approve)
    })
    rec.stop()
    expect(rec.sent).toHaveLength(1)
  })

  it('after the first submission both buttons are disabled, the form is busy and a pending status is shown', () => {
    render(<ConsentCard {...props} />)
    const { form, approve, deny } = parts()
    const rec = recordSubmissions()
    act(() => submit(form, approve))
    rec.stop()
    expect(form).toHaveAttribute('aria-busy', 'true')
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    for (const b of buttons) expect(b).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('מחבר את Claude…')
    expect(approve).toBeDisabled()
    expect(deny).toBeDisabled()
  })

  it('Deny shows its own pending wording', () => {
    render(<ConsentCard {...props} />)
    const { form, deny } = parts()
    const rec = recordSubmissions()
    act(() => submit(form, deny))
    rec.stop()
    expect(screen.getByRole('status')).toHaveTextContent('מבטל…')
  })

  it('before any submission nothing is disabled or busy, and the native POST target is unchanged', () => {
    render(<ConsentCard {...props} />)
    const { form, approve, deny } = parts()
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', '/api/oauth/consent')
    expect(form).not.toHaveAttribute('aria-busy')
    expect(approve).not.toBeDisabled()
    expect(deny).not.toBeDisabled()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
