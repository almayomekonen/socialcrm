'use client'

import { Btn } from '@/lib/btns/Btn'
import { useState } from 'react'
import EditTeamForm from './EditTeamForm'
import { deleteTeam } from '../../actions/usersNteams'
import { api } from '@/lib/funcs'
import ModalPop from '../../lib/modals/ModalPop'

export default function TeamCard({ teams, users, mngrs, offices }) {
  const [curTeam, setCurTeam] = useState(null)

  function onClose() {
    setCurTeam(null)
  }

  async function onDelete(id, name) {
    const isDel = confirm('בטוח למחוק את הצוות ' + name + ' ?')

    if (isDel) api(deleteTeam, id)
  }

  return (
    <>
      <div className='flex justify-between my-6'>
        <h1 className=' title'>עריכת צוותים</h1>
        <Btn lbl='הוספת צוות' icon='plus' onClick={() => setCurTeam(true)} />
      </div>
      <div className='grid grid-cols-1 sm:grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-4'>
        {teams?.map((team) => (
          <div className='bg-white p-6 rounded-lg shadow-md' key={team.id}>
            <div className='flex justify-between items-center border-b pb-4 mb-4'>
              <h3 className='text-xl font-bold text-primary'>{team.name}</h3>
              <div className='flex gap-2'>
                <Btn variant='outline' size='icon' icon='pen' onClick={() => setCurTeam(team)} />
                <Btn variant='outline' size='icon' icon='trash' onClick={() => onDelete(team.id, team.name)} />
              </div>
            </div>
            <div className='space-y-4'>
              <Display arr={team.mngrs} title='מנהלים' />
              <Display arr={team.users} title={`נציגים (${team.users?.length})`} />
              <Display arr={team.offices} title='מתפעלים' />
            </div>
          </div>
        ))}
      </div>

      <ModalPop className='w-xl' pos='middle' open={!!curTeam} onClose={onClose}>
        <EditTeamForm teams={teams} team={curTeam} users={users} mngrs={mngrs} offices={offices} onClose={onClose} />
      </ModalPop>
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
