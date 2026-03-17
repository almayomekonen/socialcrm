'use client'
import { Input } from '@/lib/form'
import { getMultiObjFormData } from '@/lib/form/funcs'
import { SubmitButton } from '@/lib/btns/SubmitBtn'
import { addAgency } from '@/actions/agencies'

export default function AddAgencyForm() {
  async function onSubmit(e) {
    const data = getMultiObjFormData(e)
    await addAgency(data)
  }
  return (
    <form onSubmit={onSubmit}>
      <div data-prefix='agency' className='mt-2'>
        <Input name='name' lbl='שם הסוכנות' />
        {/* <FileUploader name='img' type='image' single /> */}
      </div>
      <div data-prefix='user' className='grid grid-cols-2 gap-4 mt-4'>
        <Input name='firstName' lbl='שם פרטי' />
        <Input name='lastName' lbl='שם משפחה' />
        <Input name='email' lbl='אימייל' className='col-span-2' />
      </div>
      <SubmitButton lbl='המשך' className='w-full mt-4 flex-row-reverse' icon='left' />
    </form>
  )
}
