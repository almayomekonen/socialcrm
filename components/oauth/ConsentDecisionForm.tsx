'use client'

import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Btn } from '@/lib/btns/Btn'

type Decision = 'approve' | 'deny'
type Props = { clientName: string; csrf: string; children: ReactNode }

/**
 * The consent form's single-submission guard (UX / race prevention — the
 * server's single-use checks remain the security boundary).
 *
 * A native POST to /api/oauth/consent, exactly as before. On the FIRST submit:
 *   1. a ref lock is taken synchronously — React state alone would let a rapid
 *      second click through before the next render;
 *   2. the clicked button's decision is copied into a hidden `decision` input,
 *      because the browser builds the form data AFTER the submit event, and a
 *      button React has just disabled would be left out of it;
 *   3. both buttons are disabled and a pending status is shown.
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
    if (decisionInput.current) decisionInput.current.value = decision
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
      <input ref={decisionInput} type='hidden' name='decision' defaultValue='' />
      {pending ? (
        <p role='status' className='text-sm text-gray-600'>
          {pending === 'approve' ? `מחבר את ${clientName}…` : 'מבטל…'}
        </p>
      ) : null}
      <div className='mt-auto flex items-center justify-end gap-3'>
        <Btn as='submit' data-decision='deny' lbl='ביטול' variant='outline' icon='xmark' disabled={pending !== null} />
        <Btn as='submit' data-decision='approve' lbl={`אשר חיבור ל-${clientName}`} icon='check' disabled={pending !== null} />
      </div>
    </form>
  )
}
