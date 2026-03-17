'use client'
import { Select } from '@/lib/form'
import { getFormData2 } from '@/lib/form/funcs'
import { Btn } from '@/lib/btns/Btn'
import { api } from '@/lib/funcs'
import { updateUserInfoData } from '@/actions/usersNteams'

export default function LogoutMinutesForm({ user }) {
  async function onSubmit(e) {
    const data = getFormData2(e)
    api(updateUserInfoData, [data, user.id])
  }

  return (
    <form onSubmit={onSubmit}>
      <Select
        options={[
          { name: '5 דקות', id: 5 },
          { name: '10 דקות', id: 10 },
          { name: '20 דקות', id: 20 },
          { name: '30 דקות', id: 30 },
        ]}
        defaultValue={user.logoutMinutes}
        name='logoutMinutes'
      />
      <Btn lbl='שמירה' className='w-full mt-4' />
    </form>
  )
}
