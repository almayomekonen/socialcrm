'use client'
import React from 'react'
import { Input } from '@/lib/form'
import { getMultiObjFormData } from '@/lib/form/funcs'
import { Btn } from '@/lib/btns/Btn'
import { api } from '@/lib/funcs'
import { updateFullUser } from '@/actions/usersNteams'
import { useT } from '@/lib/i18n/I18nProvider'

export default function UserDetailsForm({ user }) {
  const t = useT()
  async function onSubmit(e) {
    const data = getMultiObjFormData(e)
    console.log(data)

    api(updateFullUser, [data, user.id])
  }

  return (
    <form onSubmit={onSubmit}>
      <div data-prefix='userData' className='grid grid-cols-2 gap-4 '>
        <Input name='firstName' lbl={t('settings.account.details.firstName')} defaultValue={user.firstName} />
        <Input name='lastName' lbl={t('settings.account.details.lastName')} defaultValue={user.lastName} />
        <Input name='email' lbl={t('settings.account.details.email')} defaultValue={user.email} />
        <Input name='idNum' lbl={t('settings.account.details.idNum')} defaultValue={user.idNum} required={false} />
      </div>
      <div data-prefix='userInfoData' className='grid grid-cols-2 mt-4 gap-4 '>
        <Input name='tifulEmail' lbl={t('settings.account.details.businessEmail')} defaultValue={user.tifulEmail} required={false} />
      </div>
      <Btn lbl={t('settings.account.details.save')} className='w-full mt-4' />
    </form>
  )
}
