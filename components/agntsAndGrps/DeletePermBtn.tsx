'use client'

import Icon from '@/lib/Icon'
import { removeAuthUser } from '../../actions/usersNteams'
import { toast } from '@/lib/toast'

export default function DeletePermBtn({ curUserId, removeId }) {
  async function onDeletePerm() {
    const isDel = confirm('בטוח למחוק את ההרשאה?')

    toast('loading')
    if (isDel) await removeAuthUser(curUserId, removeId)
    toast('success', 'ההרשאה נמחקה')
  }

  return (
    <button title='הסר נציג מורשה' onClick={onDeletePerm}>
      <Icon name='xmark' className='size-3.5 hover:bg-red-700' />
    </button>
  )
}
