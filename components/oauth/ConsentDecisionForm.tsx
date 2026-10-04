'use client'

import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Btn } from '@/lib/btns/Btn'

type Decision = 'approve' | 'deny'
// Visual busy state without the `disabled` attribute (see below).
const BUSY = 'aria-disabled:pointer-events-none aria-disabled:opacity-50'
type Props = { clientName: string; csrf: string; children: ReactNode }

/**
 * The consent form: a native POST to /api/oauth/consent that works with or
 * without JavaScript (the server's single-use checks remain the security
 * boundary; this is UX / race prevention).
 *
 * EXACTLY ONE `decision` ALWAYS COMES FROM THE CLICKED BUTTON (name/value),
 * with or without JavaScript. Nothing in the form is mutated between the submit
 * event and the browser building the form data, so there is no dependency on
 * when React commits:
 *   - there is no hidden `decision` input — an earlier one was rewritten to ''
 *     by React's re-render (for type=hidden, value and defaultValue are the same
 *     attribute), which committed in a microtask BEFORE the browser serialized
 *     the form, so production received decision='';
 *   - the buttons are never given the `disabled` attribute — a disabled
 *     submitter is left out of the form data.
 *
 * Hydrated, the FIRST submit takes a synchronous ref lock (React state alone
 * would let a rapid second click through) and shows the pending state with
 * aria-disabled + a status line. Every later submit while locked is prevented,
 * whichever button or key triggers it. A submit without a recognised submitter
 * is prevented and does not lock.
 */
export default function ConsentDecisionForm({ clientName, csrf, children }: Props) {
  const locked = useRef(false)
  const [pending, setPending] = useState<Decision | null>(null)

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null
    const decision = submitter?.dataset.decision
    if (locked.current || (decision !== 'approve' && decision !== 'deny')) {
      e.preventDefault()
      return
    }
    locked.current = true
    setPending(decision)
  }

  return (
    <form
      method='post'
      action='/api/oauth/consent'
      onSubmit={onSubmit}
      aria-busy={pending ? true : undefined}
      className='rounded-lg border border-gray-200 bg-white p-6 flex flex-col gap-4'
    >
      {children}
      <input type='hidden' name='csrf' value={csrf} />
      {pending ? (
        <p role='status' className='text-sm text-gray-600'>
          {pending === 'approve' ? `מחבר את ${clientName}…` : 'מבטל…'}
        </p>
      ) : null}
      <div className='mt-auto flex items-center justify-end gap-3'>
        <Btn
          as='submit'
          name='decision'
          value='deny'
          data-decision='deny'
          lbl='ביטול'
          variant='outline'
          icon='xmark'
          disabled={false}
          aria-disabled={pending !== null ? true : undefined}
          className={BUSY}
        />
        <Btn
          as='submit'
          name='decision'
          value='approve'
          data-decision='approve'
          lbl={`אשר חיבור ל-${clientName}`}
          icon='check'
          disabled={false}
          aria-disabled={pending !== null ? true : undefined}
          className={BUSY}
        />
      </div>
    </form>
  )
}
