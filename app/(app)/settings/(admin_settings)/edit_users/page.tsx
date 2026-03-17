import UsersTable from '@/components/agntsAndGrps/UsersTable'
import InvitationsTable from '@/components/invitations/InvitationsTable'
import { db } from '@/config/db'
import { getInvitations } from '@/db/invitations'
import { getAllPropsUsers, getTeams } from '@/db/usersNTeams'
import { isAgentOrMngr } from '@/types/roles'

export default async function EditAgentsPage() {
  const users = await getAllPropsUsers()
  const teams = await getTeams()
  const invitations = await getInvitations()

  const agnts = users.filter((user) => isAgentOrMngr(user.role))

  return (
    <div className='mb-8'>
      <h1 className='title my-6'>עריכת משתמשים</h1>
      <UsersTable users={users} agnts={agnts} teams={teams} tblPref={null} key={Math.random()} />
      <h1 className='title my-6'>הזמנות</h1>

      <InvitationsTable data={invitations} tblPref={null} key={Math.random()} />
    </div>
  )
}
