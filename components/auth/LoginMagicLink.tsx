'use client'

import { Input } from '@/lib/form'
import { isUserExists, sendToken } from '../../actions/auth'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SubmitButton } from '@/lib/btns/SubmitBtn'
import { getFormData2 } from '@/lib/form/funcs'
import { toast } from '@/lib/toast'

export default function LoginMagicLink({ error }) {
  if (error) error = 'הקישור אינו תקין או שפג תוקפו'
  const [msg, setMsg] = useState(error)
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()
  const reqIdRef = useRef(0)
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
      if (reqIdRef.current === myId) toast('loading', 'הפעולה לוקחת יותר זמן מהרגיל...')
    }, 10000)
    timersRef.current.retry = setTimeout(() => {
      if (reqIdRef.current === myId) {
        toast('error', 'לוקח זמן רב מהרגיל, נסה שוב')
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
    <>
      <div className='relative pt-6 pb-5'>
        <div className='absolute inset-0 flex mt-1'>
          <div className='w-full border-t border-gray-500' />
        </div>

        <div className='relative flex justify-center'>
          <span className='px-4 bg-white'>או</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className=''>
        <Input name='email' lbl='התחברות עם מייל' type='email' />
        {/* <Btn lbl='התחברות' className='w-full mt-2' /> */}
        <SubmitButton lbl={submitting ? 'טוען...' : 'התחל בחינם'} className='w-full mt-2' icon='envelope' disabled={submitting} />

        {msg && <p className='text-red-600 text-lg mt-4'>* {msg}</p>}
      </form>
    </>
  )
}
