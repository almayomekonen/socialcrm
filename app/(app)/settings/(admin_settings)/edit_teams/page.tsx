import { getUsers, getAllTeams } from '@/db/usersNTeams'
import { isMngr } from '@/types/roles'
import TeamCard from '@/components/agntsAndGrps/TeamCard'

export default async function EditTeamsPage({ searchParams }) {
  let teams = await getAllTeams()

  const users = await getUsers({ withOfficeUsers: true })

  const mngrs = users.filter((user) => isMngr(user.role as any))

  const offices = users.filter((user) => user.role === 'OFFICE')

  return (
    <div className='mb-6 overflow-y-auto'>
      <TeamCard teams={teams} users={users} mngrs={mngrs} offices={offices} />
    </div>
  )
}
