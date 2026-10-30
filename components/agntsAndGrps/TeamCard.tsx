'use client'

import { Btn } from '@/lib/btns/Btn'
import { useState } from 'react'
import EditTeamForm from './EditTeamForm'
import { deleteTeam } from '../../actions/usersNteams'
import { api } from '@/lib/funcs'
import ModalPop from '../../lib/modals/ModalPop'
import ConfirmPop from '../../lib/modals/ConfirmPop'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'

export default function TeamCard({ teams, users, mngrs, offices }) {
  const t = useT()
  // The page's top-level blocks declare the interface language (the dialogs declare their own).
  const region = useRegionAttrs()
  const [curTeam, setCurTeam] = useState(null)
  const [teamToDelete, setTeamToDelete] = useState<{ id: any; name: string } | null>(null)

  function onClose() {
    setCurTeam(null)
  }

  function onDelete(id, name) {
    setTeamToDelete({ id, name })
  }

  async function performTeamDelete() {
    if (!teamToDelete) return
    await api(deleteTeam, teamToDelete.id)
    setTeamToDelete(null)
  }

  return (
    <>
      <div className='flex justify-between mb-8' {...region}>
        <h1 className='title'>{t('admin.teams.title')}</h1>
        <Btn lbl={t('admin.teams.add')} icon='plus' onClick={() => setCurTeam(true)} />
      </div>
      {!teams?.length && <div className='flex items-center justify-center h-64 text-gray-400' {...region}>{t('admin.teams.empty')}</div>}
      <div className='grid grid-cols-1 sm:grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-4' {...region}>
        {teams?.map((team) => (
          <div className='bg-white p-6 rounded-lg shadow-md' key={team.id}>
            <div className='flex justify-between items-center border-b pb-4 mb-4'>
              <h3 className='text-xl font-bold text-primary'>{team.name}</h3>
              <div className='flex gap-2'>
                <Btn variant='outline' size='icon' icon='pen' aria-label={t('admin.teams.edit')} onClick={() => setCurTeam(team)} />
                <Btn variant='outline' size='icon' icon='trash' aria-label={t('admin.teams.delete')} onClick={() => onDelete(team.id, team.name)} />
              </div>
            </div>
            <div className='space-y-4'>
              <Display arr={team.mngrs} title={t('admin.teams.mngrs')} />
              <Display arr={team.users} title={t('admin.teams.repsCount', { count: String(team.users?.length) })} />
              <Display arr={team.offices} title={t('admin.teams.offices')} />
            </div>
          </div>
        ))}
      </div>

      <ModalPop className='w-xl' pos='middle' open={!!curTeam} onClose={onClose} label={t('admin.teams.edit')} translated>
        <EditTeamForm teams={teams} team={curTeam} users={users} mngrs={mngrs} offices={offices} onClose={onClose} />
      </ModalPop>

      <ConfirmPop
        open={!!teamToDelete}
        destructive
        onClose={() => setTeamToDelete(null)}
        onConfirm={performTeamDelete}
        msg={t('admin.teams.deleteConfirm', { name: teamToDelete?.name ?? '' })}
        translated
      />
    </>
  )
}

function Display({ arr, title }) {
  return (
    arr.length > 0 && (
      <div>
        <h4 className='font-semibold text-lg mb-1'>{title}</h4>
        <p className=''>{arr?.map((el) => el.name).join(', ')}</p>
      </div>
    )
  )
}
