'use client'

import { Input } from '@/lib/form'
import { Btn } from '@/lib/btns/Btn'
import { getFormData2 } from '@/lib/form/funcs'
import { upsertUser } from '../../actions/usersNteams'
import { api } from '@/lib/funcs'

export default function EditSelfUser({ user }) {
  async function onSubmit(e) {
    const data = getFormData2(e)
    api(upsertUser, [data, user.id])
  }

  return (
    <div className=' w-fit'>
      <form key={user?.id} onSubmit={onSubmit} className='grid grid-cols-2 gap-4 '>
        <Input lbl='שם פרטי' name='firstName' defaultValue={user?.firstName} />
        <Input lbl='שם משפחה' name='lastName' defaultValue={user?.lastName} />
        <Input lbl='דואר אלקטרוני' name='email' defaultValue={user?.email} />

        <Input lbl='מספר טלפון' name='phone' required={false} defaultValue={user?.phone} />

        <Btn lbl='שמירה' icon='floppy-disk' className='col-span-2 mt-2' />
      </form>
    </div>
  )
}
