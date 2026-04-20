'use client'

import { useState } from 'react'
import { toast } from '@/lib/toast'
import { deletePromo } from '../../actions/promos'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'

export default function DeletePromoBtn({ promoId }) {
  const [open, setOpen] = useState(false)

  async function performDelete() {
    setOpen(false)
    toast('loading')
    await deletePromo(promoId)
    toast('success', 'המבצע נמחק')
  }

  return (
    <>
      <Btn variant='outline' size='icon' onClick={() => setOpen(true)} icon='trash' />
      <ConfirmPop
        open={open}
        destructive
        onClose={() => setOpen(false)}
        onConfirm={performDelete}
        msg='בטוח למחוק את המבצע?'
      />
    </>
  )
}
