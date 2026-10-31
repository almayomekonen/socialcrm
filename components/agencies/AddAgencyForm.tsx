'use client'
import { Input } from '@/lib/form'
import { getMultiObjFormData } from '@/lib/form/funcs'
import { Button } from '@/components/lumen/ui/button'
import AuthControlRow from '@/components/auth/AuthControlRow'
import { addAgency } from '@/actions/agencies'
import { useEffect, useRef, useState } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { toast } from '@/lib/toast'
import { useT } from '@/lib/i18n/I18nProvider'
import { untranslatedAttrs } from '@/lib/i18n/config'
import { authMessageText } from '@/components/auth/authMessageText'

export default function AddAgencyForm({ defaultEmail, defaultName }: { defaultEmail?: string; defaultName?: string }) {
  const t = useT()
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
      if (reqIdRef.current === myId) toast('loading', t('auth.wait.slow'))
    }, 10000)
    timersRef.current.retry = setTimeout(() => {
      if (reqIdRef.current === myId) {
        toast('error', t('auth.wait.timeout'))
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
        <Input name='name' lbl={t('auth.register.businessName')} />
      </div>
      <div data-prefix='user' className='grid grid-cols-2 gap-4'>
        <Input name='firstName' lbl={t('auth.register.firstName')} defaultValue={defaultName} />
        <Input name='lastName' lbl={t('auth.register.lastName')} />
        {/* Email keeps its own full row. The original `lg:col-span-1` was sized
            against the old `lg:max-w-none` container; inside Lumen's `max-w-sm`
            it measures 162px, too narrow for an address — and since email owns
            this row either way, full width costs no height. */}
        <div className='col-span-2'>
          {/* type='email' makes the browser refuse "natel" before submit and
              gives phones the @ keyboard; autoComplete='email' lets the phone
              offer the saved address, so most people never type it at all. */}
          <Input name='email' lbl={t('auth.magic.email')} type='email' autoComplete='email' defaultValue={defaultEmail} />
        </div>
      </div>
      {/* Same component, same row as `/auth` — Lumen fills this slot on signup
          with the terms checkbox + terms link. `/terms` is a real route. */}
      <AuthControlRow
        checkboxId='terms'
        checkboxLabel={t('auth.register.terms')}
        actionLabel={t('auth.register.termsLink')}
        checkboxRequired
        href='/terms'
      />
      {error && <ErrorLine error={error} t={t} />}
      <div>
        <Button type='submit' className='mt-2 w-full shadow-none' disabled={submitting}>
          {submitting ? t('auth.magic.submitting') : t('auth.register.submit')}
        </Button>
      </div>
    </form>
  )
}

/** The server's refusal (Hebrew, no code) worded by exact sentence; anything else as received. */
function ErrorLine({ error, t }: { error: string; t: ReturnType<typeof useT> }) {
  const { text, known } = authMessageText(error, t)
  return (
    <p className='text-destructive text-sm' {...(known ? {} : untranslatedAttrs(t.locale))}>
      {text}
    </p>
  )
}
