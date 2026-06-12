'use client'
import Link from 'next/link'
import { Input } from '@/lib/form'
import { getMultiObjFormData } from '@/lib/form/funcs'
import { SubmitButton } from '@/lib/btns/SubmitBtn'
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
    <form onSubmit={onSubmit}>
      <div data-prefix='agency' className='mt-2'>
        <Input name='name' lbl='שם העסק' />
      </div>
      <div data-prefix='user' className='grid grid-cols-2 gap-4 mt-4'>
        <Input name='firstName' lbl='שם פרטי' defaultValue={defaultName} />
        <Input name='lastName' lbl='שם משפחה' />
        {/* Full-width on mobile; lg restores the original desktop half-width cell */}
        <div className='col-span-2 lg:col-span-1'>
          <Input name='email' lbl='אימייל' defaultValue={defaultEmail} />
        </div>
      </div>
      {error && <p className='text-sm text-red-500 mt-2'>{error}</p>}
      <SubmitButton lbl={submitting ? 'טוען...' : 'צור חשבון'} className='w-full mt-4' icon={false} disabled={submitting} />
      <p className='text-gray-500 text-xs text-center mt-3'>
        כבר יש לך חשבון?{' '}
        <Link
          href='/auth'
          className='text-primary-text font-semibold hover:text-primary transition-colors'
        >
          התחבר
        </Link>
      </p>
    </form>
  )
}
