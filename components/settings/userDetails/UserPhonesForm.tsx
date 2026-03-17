'use client'
import React from 'react'
import { Input } from '@/lib/form'
import { getMultiObjFormData } from '@/lib/form/funcs'
import { Btn } from '@/lib/btns/Btn'
import { api } from '@/lib/funcs'
import { updateFullUser } from '@/actions/usersNteams'

export default function UserContactForm({ user }) {
  async function onSubmit(e) {
    const data = getMultiObjFormData(e)
    api(updateFullUser, [data, user.id])
  }

  return (
    <form onSubmit={onSubmit}>
      <div className='grid grid-cols-2 gap-4'>
        <Input name='userData.phone' lbl='טלפון' defaultValue={user.phone} />
        <Input name='userInfoData.fax' lbl='פקס' defaultValue={user.fax} />
        <Input name='userInfoData.officePhone' lbl='טלפון קווי' defaultValue={user.officePhone} />
      </div>
      <Btn lbl='שמירה' className='w-full mt-4' />
    </form>
  )
}
