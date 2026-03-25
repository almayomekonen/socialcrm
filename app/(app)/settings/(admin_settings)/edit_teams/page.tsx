import { getUsers, getAllTeams } from '@/db/usersNTeams'
import { isMngr } from '@/types/roles'
import TeamCard from '@/components/agntsAndGrps/TeamCard'

export default async function EditTeamsPage({ searchParams }) {
  let teams = await getAllTeams()

  const users = await getUsers({ withOfficeUsers: true })

  const mngrs = users.filter((user) => isMngr(user.role as any))

  const offices = users.filter((user) => user.role === 'OFFICE')

  if (teams.length === 0) {
    return <div className='flex items-center justify-center h-64 text-gray-400'>אין צוותים עדיין</div>
  }

  return (
    <div className='mb-6 overflow-y-auto'>
      <TeamCard teams={teams} users={users} mngrs={mngrs} offices={offices} />
    </div>
  )
}
