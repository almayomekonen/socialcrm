'use client'
import { Input } from '@/lib/form'
import { getMultiObjFormData } from '@/lib/form/funcs'
import { Button } from '@/components/lumen/ui/button'
import AuthControlRow from '@/components/auth/AuthControlRow'
import { addAgency } from '@/actions/agencies'
import { useEffect, useRef, useState } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { toast } from '@/lib/toast'

export default function AddAgencyForm({ defaultEmail, defaultName }: { defaultEmail?: string; defaultName?: string }) {
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const reqIdRef = useRef(0)
  const timersRef = useRef<{ slow?: ReturnType<typeof setTimeout>; retry?: ReturnType<typeof setTimeout> }>({})

  useEffect(() => () => {
    if (timersRef.current.slow) clearTimeout(timersRef.current.slow)
    if (timersRef.current.retry) clearTimeout(timersRef.current.retry)
  }, [])

  async function onSubmit(e) {
    e.preventDefault()
    if (submitting) return

    setError(null)
    setSubmitting(true)
    const data = {
      ...getMultiObjFormData(e),
      // Analytics-only hint: which device class completed registration.
      device: window.matchMedia('(min-width: 1000px)').matches ? 'desktop' : 'mobile',
      provider: defaultEmail || defaultName ? 'google' : 'email',
    }
    const myId = ++reqIdRef.current

    timersRef.current.slow = setTimeout(() => {
      if (reqIdRef.current === myId) toast('loading', 'הפעולה לוקחת יותר זמן מהרגיל...')
    }, 10000)
    timersRef.current.retry = setTimeout(() => {
      if (reqIdRef.current === myId) {
        toast('error', 'לוקח זמן רב מהרגיל, נסה שוב')
        setSubmitting(false)
      }
    }, 20000)

    try {
      const res = await addAgency(data)
      if (reqIdRef.current !== myId) return
      clearTimeout(timersRef.current.slow)
      clearTimeout(timersRef.current.retry)
      if (res && typeof res === 'object' && 'error' in res) {
        setError(res.error)
        setSubmitting(false)
      }
    } catch (err) {

      unstable_rethrow(err)
      if (reqIdRef.current !== myId) return
      clearTimeout(timersRef.current.slow)
      clearTimeout(timersRef.current.retry)
      console.error('[AUTH] route=register client_error', err)
      setError('אירעה שגיאה ברשת, נסה שוב')
      setSubmitting(false)
    }
  }

  return (
    /* Lumen `/signup` supplies the block rhythm (`grid gap-4`) and the submit
       (`mt-2 w-full shadow-none`), but the FIELD ARRANGEMENT is ours: the
       original two-column name row is kept so the form stays short. The old
       `mt-4` on the user block is dropped because the form's `gap-4` is the
       same 16px — re-adding it would double the gap.
       `data-prefix` wrappers are untouched: `getNestedPrefix` walks ancestors
       for them, so the agency/user namespacing is unchanged. */
    <form onSubmit={onSubmit} className='grid gap-4'>
      <div data-prefix='agency'>
        <Input name='name' lbl='שם העסק' />
      </div>
      <div data-prefix='user' className='grid grid-cols-2 gap-4'>
        <Input name='firstName' lbl='שם פרטי' defaultValue={defaultName} />
        <Input name='lastName' lbl='שם משפחה' />
        {/* Email keeps its own full row. The original `lg:col-span-1` was sized
            against the old `lg:max-w-none` container; inside Lumen's `max-w-sm`
            it measures 162px, too narrow for an address — and since email owns
            this row either way, full width costs no height. */}
        <div className='col-span-2'>
          <Input name='email' lbl='אימייל' defaultValue={defaultEmail} />
        </div>
      </div>
      {/* Same component, same row as `/auth` — Lumen fills this slot on signup
          with the terms checkbox + terms link. `/terms` is a real route. */}
      <AuthControlRow
        checkboxId='terms'
        checkboxLabel='אני מסכים לתנאים'
        actionLabel='תנאי השימוש'
        href='/terms'
      />
      {error && <p className='text-destructive text-sm'>{error}</p>}
      <div>
        <Button type='submit' className='mt-2 w-full shadow-none' disabled={submitting}>
          {submitting ? 'טוען...' : 'צור חשבון'}
        </Button>
      </div>
    </form>
  )
}
