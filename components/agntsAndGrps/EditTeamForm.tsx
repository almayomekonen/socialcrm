'use client'

import { useState } from 'react'
import { Input } from '@/lib/form'
import { getFormData2 } from '@/lib/form/funcs'
import { upsertTeam } from '../../actions/usersNteams'
import { SubmitButton } from '@/lib/btns/SubmitBtn'
import { api } from '@/lib/funcs'
import { MultiSelectSearch } from '@/lib/form/MultiSelectSearch'
import Title from '@/lib/Title'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { useT } from '@/lib/i18n/I18nProvider'

export default function EditTeamForm({ teams, team, users, mngrs, offices, onClose }) {
  const t = useT()
  const [errMsg, setErrMsg] = useState<string | null>(null)

  async function onSubmit(e) {
    const data = getFormData2(e) as any
    if (!data.userIds.length) return setErrMsg(t('admin.teams.form.noReps'))
    if (data.mngrIds.some((mngrId) => data.userIds.includes(mngrId))) return setErrMsg(t('admin.teams.form.mngrIsRep'))
    console.log('data', data)

    await api(upsertTeam, [team?.id, data])
    onClose()
  }

  return (
    <>
      <form onSubmit={onSubmit} className='space-y-4'>
        <Title lbl={team?.id ? t('admin.teams.edit') : t('admin.teams.add')} icon={team?.id ? 'pen' : 'plus'} />
        <Input name='name' defaultValue={team?.name} lbl={t('admin.teams.form.name')} />
        <MultiSelectSearch
          key={Math.random()}
          options={mngrs}
          selected={team?.mngrs?.map((mngr) => mngr.id)}
          name='mngrIds'
          lbl={t('admin.teams.form.mngrs')}
        />
        <MultiSelectSearch
          key={Math.random()}
          options={users}
          selected={team?.users?.map((user) => user.id)}
          name='userIds'
          lbl={t('admin.teams.form.reps')}
        />
        <MultiSelectSearch options={offices} selected={team?.offices?.map((office) => office.id)} name='officeIds' lbl={t('admin.teams.form.offices')} />

        <SubmitButton className='w-full' />
      </form>
      <ConfirmPop
        open={!!errMsg}
        hideCancel
        onClose={() => setErrMsg(null)}
        onConfirm={() => setErrMsg(null)}
        msg={errMsg ?? ''}
        translated
      />
    </>
  )
}
