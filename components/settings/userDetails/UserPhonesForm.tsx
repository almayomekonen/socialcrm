'use client'
import React from 'react'
import { Input } from '@/lib/form'
import { getMultiObjFormData } from '@/lib/form/funcs'
import { Btn } from '@/lib/btns/Btn'
import { api } from '@/lib/funcs'
import { updateFullUser } from '@/actions/usersNteams'
import { useT } from '@/lib/i18n/I18nProvider'

export default function UserContactForm({ user }) {
  const t = useT()
  async function onSubmit(e) {
    const data = getMultiObjFormData(e)
    api(updateFullUser, [data, user.id])
  }

  return (
    <form onSubmit={onSubmit}>
      <div className='grid grid-cols-2 gap-4'>
        <Input name='userData.phone' lbl={t('settings.account.details.phone')} defaultValue={user.phone} />
        <Input name='userInfoData.fax' lbl={t('settings.account.details.fax')} defaultValue={user.fax} />
        <Input name='userInfoData.officePhone' lbl={t('settings.account.details.officePhone')} defaultValue={user.officePhone} />
      </div>
      <Btn lbl={t('settings.account.details.saveContact')} className='w-full mt-4' />
    </form>
  )
}
