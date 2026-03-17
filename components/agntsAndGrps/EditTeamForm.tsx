'use client'

import { Input } from '@/lib/form'
import { getFormData2 } from '@/lib/form/funcs'
import { upsertTeam } from '../../actions/usersNteams'
import { SubmitButton } from '@/lib/btns/SubmitBtn'
import { api } from '@/lib/funcs'
import { MultiSelectSearch } from '@/lib/form/MultiSelectSearch'
import Title from '@/lib/Title'

export default function EditTeamForm({ teams, team, users, mngrs, offices, onClose }) {
  async function onSubmit(e) {
    const data = getFormData2(e) as any
    if (!data.userIds.length) return alert('יש לבחור נציגים')
    if (data.mngrIds.some((mngrId) => data.userIds.includes(mngrId))) return alert('מנהל לא יכול להיות גם נציג')
    console.log('data', data)

    await api(upsertTeam, [team?.id, data])
    onClose()
  }

  return (
    <form onSubmit={onSubmit} className='space-y-4'>
      <Title lbl={team?.id ? 'עריכת צוות' : 'הוספת צוות'} icon={team?.id ? 'pen' : 'plus'} />
      <Input name='name' defaultValue={team?.name} lbl='שם הצוות' />
      <MultiSelectSearch
        key={Math.random()}
        options={mngrs}
        selected={team?.mngrs?.map((mngr) => mngr.id)}
        name='mngrIds'
        lbl='מנהלים'
      />
      <MultiSelectSearch
        key={Math.random()}
        options={users}
        selected={team?.users?.map((user) => user.id)}
        name='userIds'
        lbl='נציגים'
      />
      <MultiSelectSearch options={offices} selected={team?.offices?.map((office) => office.id)} name='officeIds' lbl='מתפעלים' />

      <SubmitButton className='w-full' />
    </form>
  )
}
