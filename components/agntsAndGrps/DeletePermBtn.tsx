'use client'

import { useState } from 'react'
import Icon from '@/lib/Icon'
import { removeAuthUser } from '../../actions/usersNteams'
import { toast } from '@/lib/toast'
import ConfirmPop from '@/lib/modals/ConfirmPop'

export default function DeletePermBtn({ curUserId, removeId }) {
  const [open, setOpen] = useState(false)

  async function performDelete() {
    setOpen(false)
    toast('loading')
    await removeAuthUser(curUserId, removeId)
    toast('success', 'ההרשאה נמחקה')
  }

  return (
    <>
      <button title='הסר נציג מורשה' onClick={() => setOpen(true)}>
        <Icon name='xmark' className='size-3.5 hover:bg-red-700' />
      </button>
      <ConfirmPop
        open={open}
        destructive
        onClose={() => setOpen(false)}
        onConfirm={performDelete}
        msg='בטוח למחוק את ההרשאה?'
      />
    </>
  )
}
