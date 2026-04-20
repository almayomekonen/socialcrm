'use client'
import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { getFormData2 } from '@/lib/form/funcs'
import { transferSales } from '../../actions/usersNteams'
import { api } from '@/lib/funcs'
import Title from '@/lib/Title'
import { SelectSearch } from '@/lib/form/SelectSearch'
import ConfirmPop from '@/lib/modals/ConfirmPop'

export default function TransferSalesForm({ user, users, setCurUser = null }) {
  const [pending, setPending] = useState<{ userId: number; name: string } | null>(null)

  function onSubmit(e) {
    e.preventDefault()
    const data = getFormData2(e)
    const targetUserId = Number(data.userId)
    const targetName = users.find((u) => u.id === targetUserId)?.name
    setPending({ userId: targetUserId, name: targetName })
  }

  async function onConfirm() {
    if (!pending) return
    api(transferSales, [user?.id, pending.userId])
    setPending(null)
    if (setCurUser) setCurUser(null)
  }

  return (
    <div id='transferSales' className='modal_pop' popover='auto'>
      <Title lbl='העברת לידים לנציג' />
      <form onSubmit={onSubmit} className='py-4'>
        <SelectSearch className='w-64' name='userId' lbl='בחר נציג להעברת הלידים' options={users} />
        <Btn lbl='העברת לידים לנציג' className='mt-4 w-full' />
      </form>
      <ConfirmPop
        open={!!pending}
        onClose={() => setPending(null)}
        onConfirm={onConfirm}
        msg={`האם להעביר את הלידים של ${user?.name} לנציג ${pending?.name}?`}
      />
    </div>
  )
}
