'use client'

import { Btn } from '@/lib/btns/Btn'
import { deleteCont } from '../../actions/contracts'
import { api } from '@/lib/funcs'

export default function DeleteContractButton({ contract }) {
  const onDelete = async () => {
    if (!confirm(`האם למחוק את החוזה ${contract.name}?`)) return
    api(deleteCont, contract.id)
  }

  return <Btn icon='trash' variant='outline' size='icon' onClick={onDelete} />
}
