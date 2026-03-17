'use client'

import { Input } from '@/lib/form'
import { isUserExists, sendToken } from '../../actions/auth'
import { useState } from 'react'
import { SubmitButton } from '@/lib/btns/SubmitBtn'
import { getFormData2 } from '@/lib/form/funcs'

export default function LoginMagicLink({ error }) {
  if (error) error = 'חלה שגיאה באימות'
  const [msg, setMsg] = useState(error)

  async function handleSubmit(e) {
    const data = getFormData2(e) as any
    const userExist = (await isUserExists(data.email)) as any
    if (userExist.fail) return setMsg(userExist.msg)
    await sendToken(data.email)
    setMsg('לינק לאימות נשלח למייל')
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
        <SubmitButton lbl='התחברות' className='w-full mt-2' icon='envelope' />

        {msg && <p className='text-red-600 text-lg mt-4'>* {msg}</p>}
      </form>
    </>
  )
}
