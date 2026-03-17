'use client'

import { useState } from 'react'
import ExtUserForm from './ExtUserForm'
import { api } from '@/lib/funcs'
import TransferSalesForm from '../agntsAndGrps/TransferSalesForm'
import { deleteExtUser } from '@/actions/usersNteams'
import { Btn } from '@/lib/btns/Btn'

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
  async function onEdit() {
    setCurUser(user)
  }
  async function onDelete() {
    if (!confirm(`האם למחוק את ${user.name}?`)) return
    const res = await api(deleteExtUser, [user.id])
    if (res.err)
      alert(`
      המשתמש ${user.name} לא נמחק, מכיוון שיש מכירות על שמו.
      מחק את המכירות
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
      <Btn variant='outline' icon='xmark' onClick={onDelete} className='bg-red-400' title='מחיקה' />
      <Btn variant='outline' icon='right-left' onClick={onTransferSales} title='העברת מכירות' popoverTarget='transferSales' />
    </div>
  )
}
