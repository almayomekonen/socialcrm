// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { renderToStaticMarkup } from 'react-dom/server'

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
 * component) and the form data the browser would build for each — with the
 * submitter, exactly as native submission does (a disabled field, including a
 * disabled submitter, is left out). Stops jsdom's unimplemented navigation. The
 * document-level listener runs after React's root listener, so it sees React's
 * decision and any DOM changes the handler made.
 */
function recordSubmissions() {
  const sent: { decision: string[]; csrf: string[] }[] = []
  const listener = (e: Event) => {
    if (!e.defaultPrevented) {
      const form = e.target as HTMLFormElement
      const data = new FormData(form, (e as SubmitEvent).submitter)
      sent.push({ decision: data.getAll('decision').map(String), csrf: data.getAll('csrf').map(String) })
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

describe('consent form — hydrated, single submission', () => {
  it('Approve sends exactly one decision=approve and the csrf', () => {
    render(<ConsentCard {...props} />)
    const { form, approve } = parts()
    const rec = recordSubmissions()
    act(() => submit(form, approve))
    rec.stop()
    expect(rec.sent).toEqual([{ decision: ['approve'], csrf: ['c'.repeat(32)] }])
  })

  it('Deny sends exactly one decision=deny and the csrf', () => {
    render(<ConsentCard {...props} />)
    const { form, deny } = parts()
    const rec = recordSubmissions()
    act(() => submit(form, deny))
    rec.stop()
    expect(rec.sent).toEqual([{ decision: ['deny'], csrf: ['c'.repeat(32)] }])
  })

  it('the submitter is never disabled, so it always serializes its decision (no hidden decision input exists)', () => {
    render(<ConsentCard {...props} />)
    const { form, approve, deny } = parts()
    expect(form.querySelector('input[name="decision"]')).toBeNull()
    const seen: boolean[] = []
    const probe = () => seen.push(approve.matches(':disabled'), deny.matches(':disabled'))
    document.addEventListener('submit', probe)
    const rec = recordSubmissions()
    submit(form, approve)
    rec.stop()
    document.removeEventListener('submit', probe)
    expect(seen).toEqual([false, false])
    expect(rec.sent[0].decision).toEqual(['approve'])
  })

  it('the first Approve is sent with the correct decision and csrf; an immediate second Approve is blocked', () => {
    render(<ConsentCard {...props} />)
    const { form, approve } = parts()
    const rec = recordSubmissions()
    act(() => {
      submit(form, approve)
      submit(form, approve)
    })
    rec.stop()
    expect(rec.sent).toEqual([{ decision: ['approve'], csrf: ['c'.repeat(32)] }])
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
    expect(rec.sent).toEqual([{ decision: ['approve'], csrf: ['c'.repeat(32)] }])
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
    expect(rec.sent).toEqual([{ decision: ['deny'], csrf: ['c'.repeat(32)] }])
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
    expect(rec.sent).toEqual([{ decision: ['approve'], csrf: ['c'.repeat(32)] }])
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

  it('after the first submission both buttons are aria-disabled (never `disabled`), the form is busy and a pending status is shown', () => {
    render(<ConsentCard {...props} />)
    const { form, approve, deny } = parts()
    const rec = recordSubmissions()
    act(() => submit(form, approve))
    rec.stop()
    expect(form).toHaveAttribute('aria-busy', 'true')
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    for (const b of buttons) {
      expect(b).toHaveAttribute('aria-disabled', 'true')
      expect(b).not.toHaveAttribute('disabled')
    }
    expect(screen.getByRole('status')).toHaveTextContent('מחבר את Claude…')
    expect(approve).toHaveAttribute('aria-disabled', 'true')
    expect(deny).toHaveAttribute('aria-disabled', 'true')
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

/**
 * The server-rendered markup with NO client JavaScript: React never hydrates,
 * no handler runs, and the native form submission is all there is.
 */
describe('consent form — no JavaScript (server-rendered markup only)', () => {
  function staticForm() {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<ConsentCard {...props} />)
    document.body.appendChild(host)
    const form = host.querySelector('form') as HTMLFormElement
    const button = (d: string) => form.querySelector(`button[data-decision="${d}"]`) as HTMLButtonElement
    return { host, form, approve: button('approve'), deny: button('deny') }
  }

  it('both submit buttons carry name="decision" and their own value', () => {
    const { host, approve, deny } = staticForm()
    expect(approve).toHaveAttribute('type', 'submit')
    expect(approve).toHaveAttribute('name', 'decision')
    expect(approve).toHaveAttribute('value', 'approve')
    expect(deny).toHaveAttribute('type', 'submit')
    expect(deny).toHaveAttribute('name', 'decision')
    expect(deny).toHaveAttribute('value', 'deny')
    expect(approve).not.toBeDisabled()
    expect(deny).not.toBeDisabled()
    host.remove()
  })

  it('there is no hidden decision input, so nothing can add an empty decision', () => {
    const { host, form } = staticForm()
    expect(form.querySelector('input[name="decision"]')).toBeNull()
    expect(new FormData(form).getAll('decision')).toEqual([])
    host.remove()
  })

  it('a native Approve submission sends exactly decision=approve and the csrf, to the consent endpoint', () => {
    const { host, form, approve } = staticForm()
    expect(form).toHaveAttribute('method', 'post')
    expect(form).toHaveAttribute('action', '/api/oauth/consent')
    const data = new FormData(form, approve)
    expect(data.getAll('decision')).toEqual(['approve'])
    expect(data.getAll('csrf')).toEqual(['c'.repeat(32)])
    host.remove()
  })

  it('a native Deny submission sends exactly decision=deny and the csrf', () => {
    const { host, form, deny } = staticForm()
    const data = new FormData(form, deny)
    expect(data.getAll('decision')).toEqual(['deny'])
    expect(data.getAll('csrf')).toEqual(['c'.repeat(32)])
    host.remove()
  })
})
