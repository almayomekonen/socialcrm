'use client'

import { useState } from 'react'
import Icon from '@/lib/Icon'
import { removeAuthUser } from '../../actions/usersNteams'
import { toast } from '@/lib/toast'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'

export default function DeletePermBtn({ curUserId, removeId }) {
  const t = useT()
  const [open, setOpen] = useState(false)

  async function performDelete() {
    setOpen(false)
    toast('loading')
    await removeAuthUser(curUserId, removeId)
    toast('success', t('settings.account.perms.removed'))
  }

  return (
    <>
      <button title={t('settings.account.perms.remove')} onClick={() => setOpen(true)}>
        <Icon name='xmark' className='size-3.5 hover:bg-red-700' />
      </button>
      <ConfirmPop
        open={open}
        destructive
        onClose={() => setOpen(false)}
        onConfirm={performDelete}
        msg={t('settings.account.perms.removeConfirm')}
        translated
      />
    </>
  )
}
