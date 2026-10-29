'use client'

import { useState } from 'react'
import ExtUserForm from './ExtUserForm'
import { api } from '@/lib/funcs'
import TransferSalesForm from '../agntsAndGrps/TransferSalesForm'
import { deleteExtUser } from '@/actions/usersNteams'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'

export default function ExtUsers({ extUsers, users }) {
  const [curUser, setCurUser] = useState(null)

  return (
    <div>
      <ExtUserForm setCurUser={setCurUser} user={curUser} />

      <div className='flex gap-2 mt-4 max-w-4xl'>
        {extUsers.map((extUser) => (
          <ExtChip setCurUser={setCurUser} key={extUser.id} user={extUser} />
        ))}
      </div>
      <TransferSalesForm user={curUser} users={users} setCurUser={setCurUser} translated />
    </div>
  )
}

function ExtChip({ user, setCurUser }) {
  const t = useT()
  const [confirmDel, setConfirmDel] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  async function onEdit() {
    setCurUser(user)
  }

  async function performDelete() {
    setConfirmDel(false)
    const res = await api(deleteExtUser, [user.id])
    if (res.err)
      setErrMsg(t('settings.account.ext.deleteRefused', { name: user.name }))
  }

  async function onTransferSales() {
    setCurUser(user)
  }

  return (
    <div className='border rounded-full py-2 flex gap-4 px-4 bg-white'>
      <p className='me-2'>{user.name}</p>
      <Btn variant='outline' icon='pen' onClick={onEdit} title={t('settings.account.ext.edit')} />
      <Btn variant='outline' icon='xmark' onClick={() => setConfirmDel(true)} className='bg-red-400' title={t('settings.account.ext.delete')} />
      <Btn variant='outline' icon='right-left' onClick={onTransferSales} title={t('settings.account.ext.transfer')} popoverTarget='transferSales' />
      <ConfirmPop
        open={confirmDel}
        destructive
        onClose={() => setConfirmDel(false)}
        onConfirm={performDelete}
        msg={t('settings.account.ext.deleteConfirm', { name: user.name })}
        translated
      />
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
        translated
      />
    </div>
  )
}
