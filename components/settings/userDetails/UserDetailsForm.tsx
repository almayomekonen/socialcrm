'use client'
import React from 'react'
import { Input } from '@/lib/form'
import { getMultiObjFormData } from '@/lib/form/funcs'
import { Btn } from '@/lib/btns/Btn'
import { api } from '@/lib/funcs'
import { updateFullUser } from '@/actions/usersNteams'

export default function UserDetailsForm({ user }) {
  async function onSubmit(e) {
    const data = getMultiObjFormData(e)
    console.log(data)

    api(updateFullUser, [data, user.id])
  }

  return (
    <form onSubmit={onSubmit}>
      <div data-prefix='userData' className='grid grid-cols-2 gap-4 '>
        <Input name='firstName' lbl='שם פרטי' defaultValue={user.firstName} />
        <Input name='lastName' lbl='שם משפחה' defaultValue={user.lastName} />
        <Input name='email' lbl='מייל' defaultValue={user.email} />
        <Input name='idNum' lbl="מס' תעודת זהות" defaultValue={user.idNum} required={false} />
      </div>
      <div data-prefix='userInfoData' className='grid grid-cols-2 mt-4 gap-4 '>
        <Input name='tifulEmail' lbl='מייל -תפעול' defaultValue={user.tifulEmail} required={false} />
      </div>
      <Btn lbl='שמירה' className='w-full mt-4' />
    </form>
  )
}
