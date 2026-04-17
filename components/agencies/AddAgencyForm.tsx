'use client'
import { Input } from '@/lib/form'
import { getMultiObjFormData } from '@/lib/form/funcs'
import { SubmitButton } from '@/lib/btns/SubmitBtn'
import { addAgency } from '@/actions/agencies'
import { useState } from 'react'

export default function AddAgencyForm({ defaultEmail, defaultName }: { defaultEmail?: string; defaultName?: string }) {
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e) {
    setError(null)
    const data = getMultiObjFormData(e)
    const res = await addAgency(data)
    if (res && typeof res === 'object' && 'error' in res) setError(res.error)
  }

  return (
    <form onSubmit={onSubmit}>
      <div data-prefix='agency' className='mt-2'>
        <Input name='name' lbl='שם העסק' />
      </div>
      <div data-prefix='user' className='grid grid-cols-2 gap-4 mt-4'>
        <Input name='firstName' lbl='שם פרטי' defaultValue={defaultName} />
        <Input name='lastName' lbl='שם משפחה' />
        <Input name='email' lbl='אימייל' className='col-span-2' defaultValue={defaultEmail} />
      </div>
      {error && <p className='text-sm text-red-500 mt-2'>{error}</p>}
      <SubmitButton lbl='המשך' className='w-full mt-4' icon={false} />
    </form>
  )
}
