'use client'

import { toast } from '@/lib/toast'
import { deletePromo } from '../../actions/promos'
import { Btn } from '@/lib/btns/Btn'

export default function DeletePromoBtn({ promoId }) {
  async function onDeletePromo() {
    if (!confirm('בטוח למחוק את המבצע?')) return

    toast('loading')
    await deletePromo(promoId)
    toast('success', 'המבצע נמחק')
  }

  return <Btn variant='outline' size='icon' onClick={onDeletePromo} icon='trash' />
}
