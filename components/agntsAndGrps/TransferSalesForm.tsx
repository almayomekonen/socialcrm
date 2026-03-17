'use client'
import { Btn } from '@/lib/btns/Btn'
import { getFormData2 } from '@/lib/form/funcs'
import { transferSales } from '../../actions/usersNteams'
import { api } from '@/lib/funcs'
import Title from '@/lib/Title'
import { SelectSearch } from '@/lib/form/SelectSearch'

export default function TransferSalesForm({ user, users, setCurUser = null }) {
  async function onSubmit(e) {
    const data = getFormData2(e)
    if (!confirm(`האם להעביר את המכירות של ${user?.name} לנציג ${users.find((u) => u.id === Number(data.userId))?.name}?`)) return
    api(transferSales, [user?.id, Number(data.userId)])
    if (setCurUser) setCurUser(null)
  }
  return (
    <div id='transferSales' className='modal_pop' popover='auto'>
      <Title lbl='העברת מכירות לנציג' />
      <form onSubmit={onSubmit} className='py-4'>
        <SelectSearch className='w-64' name='userId' lbl='נציג' options={users} />
        <Btn lbl='העברת מכירות לנציג' className='mt-4 w-full' />
      </form>
    </div>
  )
}
