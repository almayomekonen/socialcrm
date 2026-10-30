'use client'

import { useState } from 'react'
import { toast } from '@/lib/toast'
import { deletePromo } from '../../actions/promos'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'

export default function DeletePromoBtn({ promoId }) {
  const t = useT()
  const [open, setOpen] = useState(false)

  async function performDelete() {
    setOpen(false)
    toast('loading')
    await deletePromo(promoId)
    toast('success', t('admin.promos.deleted'))
  }

  return (
    <>
      <Btn variant='outline' size='icon' aria-label={t('admin.promos.delete')} onClick={() => setOpen(true)} icon='trash' />
      <ConfirmPop
        open={open}
        destructive
        onClose={() => setOpen(false)}
        onConfirm={performDelete}
        msg={t('admin.promos.deleteConfirm')}
        translated
      />
    </>
  )
}
