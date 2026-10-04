'use client'

import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Btn } from '@/lib/btns/Btn'

type Decision = 'approve' | 'deny'
type Props = { clientName: string; csrf: string; children: ReactNode }

/**
 * The consent form: a native POST to /api/oauth/consent that works with or
 * without JavaScript (the server's single-use checks remain the security
 * boundary; this is UX / race prevention).
 *
 * Without JavaScript: the clicked submit button carries `decision` itself
 * (name/value), and the hidden `decision` input is disabled, so it is left out
 * of the form data. Exactly one `decision` reaches the server.
 *
 * Hydrated, on the FIRST submit, synchronously inside the submit event (before
 * the browser builds the form data):
 *   1. a ref lock is taken — React state alone would let a rapid second click
 *      through before the next render;
 *   2. the decision is copied into the hidden input, which is enabled;
 *   3. both buttons are disabled on the DOM directly, so the submitter is left
 *      out of the form data and the hidden input is the only `decision`. React
 *      state then renders the same disabled state plus a pending status.
 * Any later submit while locked is prevented. A submit without a recognised
 * submitter is prevented and does not lock.
 */
export default function ConsentDecisionForm({ clientName, csrf, children }: Props) {
  const locked = useRef(false)
  const decisionInput = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Decision | null>(null)

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null
    const decision = submitter?.dataset.decision
    if (locked.current || (decision !== 'approve' && decision !== 'deny')) {
      e.preventDefault()
      return
    }
    locked.current = true
    if (decisionInput.current) {
      decisionInput.current.value = decision
      decisionInput.current.disabled = false
    }
    for (const b of e.currentTarget.querySelectorAll<HTMLButtonElement>('button[name="decision"]')) b.disabled = true
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
      <input ref={decisionInput} type='hidden' name='decision' defaultValue='' disabled={pending === null} />
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
          disabled={pending !== null}
        />
        <Btn
          as='submit'
          name='decision'
          value='approve'
          data-decision='approve'
          lbl={`אשר חיבור ל-${clientName}`}
          icon='check'
          disabled={pending !== null}
        />
      </div>
    </form>
  )
}
