'use client'

import { useState } from 'react'
import ExtUserForm from './ExtUserForm'
import { api } from '@/lib/funcs'
import TransferSalesForm from '../agntsAndGrps/TransferSalesForm'
import { deleteExtUser } from '@/actions/usersNteams'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'

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
      <TransferSalesForm user={curUser} users={users} setCurUser={setCurUser} />
    </div>
  )
}

function ExtChip({ user, setCurUser }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  async function onEdit() {
    setCurUser(user)
  }

  async function performDelete() {
    setConfirmDel(false)
    const res = await api(deleteExtUser, [user.id])
    if (res.err)
      setErrMsg(`המשתמש ${user.name} לא נמחק, מכיוון שיש לידים על שמו.
מחק את הלידים
או העבר אותם לנציג אחר
ונסה שוב`)
  }

  async function onTransferSales() {
    setCurUser(user)
  }

  return (
    <div className='border rounded-full py-2 flex gap-4 px-4 bg-white'>
      <p className='me-2'>{user.name}</p>
      <Btn variant='outline' icon='pen' onClick={onEdit} title='עריכה' />
      <Btn variant='outline' icon='xmark' onClick={() => setConfirmDel(true)} className='bg-red-400' title='מחיקה' />
      <Btn variant='outline' icon='right-left' onClick={onTransferSales} title='העברת לידים' popoverTarget='transferSales' />
      <ConfirmPop
        open={confirmDel}
        destructive
        onClose={() => setConfirmDel(false)}
        onConfirm={performDelete}
        msg={`האם למחוק את ${user.name}?`}
      />
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
      />
    </div>
  )
}
