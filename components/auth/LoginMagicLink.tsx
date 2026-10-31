'use client'

import { Input } from '@/lib/form'
import { isUserExists, sendToken } from '../../actions/auth'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/lumen/ui/button'
import AuthControlRow from './AuthControlRow'
import { getFormData2 } from '@/lib/form/funcs'
import { toast } from '@/lib/toast'
import { useT } from '@/lib/i18n/I18nProvider'
import { untranslatedAttrs } from '@/lib/i18n/config'
import { authMessageText } from './authMessageText'

export default function LoginMagicLink({ error }) {
  const t = useT()
  // The status line keeps the Hebrew sentence (the suspended check compares it); it is worded at render.
  if (error) error = 'הקישור אינו תקין או שפג תוקפו'
  const [msg, setMsg] = useState(error)
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()
  const reqIdRef = useRef(0)
  const formRef = useRef<HTMLFormElement>(null)
  const timersRef = useRef<{ slow?: ReturnType<typeof setTimeout>; retry?: ReturnType<typeof setTimeout> }>({})

  useEffect(() => () => {
    if (timersRef.current.slow) clearTimeout(timersRef.current.slow)
    if (timersRef.current.retry) clearTimeout(timersRef.current.retry)
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return

    const data = getFormData2(e) as any
    setMsg(null)
    setSubmitting(true)
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
      const userExist = (await isUserExists(data.email)) as any
      if (reqIdRef.current !== myId) return
      if (userExist.fail) {
        clearTimeout(timersRef.current.slow)
        clearTimeout(timersRef.current.retry)
        if (userExist.msg === 'המשתמש מושהה') {
          setMsg(userExist.msg)
          setSubmitting(false)
          return
        }
        router.push(`/auth/register?email=${encodeURIComponent(data.email)}`)
        return
      }
      const sendResult = await sendToken(data.email)
      if (reqIdRef.current !== myId) return
      clearTimeout(timersRef.current.slow)
      clearTimeout(timersRef.current.retry)
      if ('error' in sendResult) {
        setMsg(sendResult.error)
        setSubmitting(false)
        return
      }
      setMsg('לינק לאימות נשלח למייל')
      setSubmitting(false)
    } catch (err) {
      if (reqIdRef.current !== myId) return
      clearTimeout(timersRef.current.slow)
      clearTimeout(timersRef.current.retry)
      console.error('[AUTH] route=magic_send client_error', err)
      setMsg('אירעה שגיאה ברשת, נסה שוב')
      setSubmitting(false)
    }
  }
  return (
    /* Lumen `/signin`: the field stack is `grid gap-4`, each field a
       `grid gap-1.5` Label+Input, and the submit is `mt-2 w-full shadow-none`.
       Lumen has no divider before the fields, so the old one is gone. Every
       handler above is untouched. */
    <form ref={formRef} onSubmit={handleSubmit} className='grid gap-4'>
      <div>
        <Input name='email' lbl={t('auth.magic.email')} type='email' />
      </div>
      {/* Lumen's signin control row. The action re-submits THIS form, i.e. the
          existing send-token path — no new auth logic, no new route. */}
      <AuthControlRow
        checkboxId='remember-me'
        checkboxLabel={t('auth.magic.remember')}
        actionLabel={t('auth.magic.resend')}
        onAction={() => formRef.current?.requestSubmit()}
      />
      <Button type='submit' className='mt-2 w-full shadow-none' disabled={submitting}>
        {submitting ? t('auth.magic.submitting') : t('auth.magic.submit')}
      </Button>
      {msg && <StatusLine msg={msg} t={t} />}
    </form>
  )
}

function StatusLine({ msg, t }: { msg: string; t: ReturnType<typeof useT> }) {
  const { text, known } = authMessageText(msg, t)
  return (
    <p className='text-destructive text-sm' {...(known ? {} : untranslatedAttrs(t.locale))}>
      {text}
    </p>
  )
}
