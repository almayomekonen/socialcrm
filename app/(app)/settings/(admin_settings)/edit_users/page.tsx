import UsersTable from '@/components/agntsAndGrps/UsersTable'
import InvitationsTable from '@/components/invitations/InvitationsTable'
import { db } from '@/config/db'
import { getUser } from '@/db/auth'
import { getInvitations } from '@/db/invitations'
import { getAllPropsUsers, getTeams } from '@/db/usersNTeams'
import { isAgentOrMngr } from '@/types/roles'
import { isMobileWorkspaceRequest } from '@/lib/device'
import UsersListMobile from '@/components/settings/mobile/UsersListMobile'
import { formatDate } from '@/lib/dates'

export default async function EditAgentsPage() {
  const viewer = await getUser()
  const users = await getAllPropsUsers()
  const invitations = await getInvitations()

  /**
   * MOBILE משתמשים. `UsersTable` + `InvitationsTable` are two real desktop
   * tables — measured rendering inside the mobile shell at every phone width.
   * The phone gets a list over the SAME reads instead; nothing is re-queried and
   * no authorization is re-implemented.
   *
   * Mapped to an explicit, serializable row shape here rather than passing the
   * raw `u.*` row into a Client Component: that row carries permission blobs and
   * legacy goal columns a list has no use for and a client bundle should not
   * receive.
   */
  if (await isMobileWorkspaceRequest(viewer?.agencyId)) {
    return (
      <UsersListMobile
        users={users.map((u) => ({
          id: u.id,
          name: u.name ?? '',
          email: u.email ?? null,
          phone: u.phone ?? null,
          role: u.role ?? null,
          suspended: !!u.suspended,
        }))}
        invitations={invitations.map((i) => ({
          id: i.id,
          name: [i.firstName, i.lastName].filter(Boolean).join(' '),
          email: i.email ?? null,
          role: i.role ?? null,
          status: i.status ?? null,
          expiresAt: i.expiresAt ? formatDate(i.expiresAt) : null,
        }))}
      />
    )
  }

  const teams = await getTeams()
  const agnts = users.filter((user) => isAgentOrMngr(user.role))

  return (
    <div className='mb-8'>
      <h1 className='title mb-8'>עריכת משתמשים</h1>
      <UsersTable users={users} agnts={agnts} teams={teams} tblPref={null} key={Math.random()} />
      <h1 className='title my-6'>הזמנות</h1>

      <InvitationsTable data={invitations} tblPref={null} key={Math.random()} />
    </div>
  )
}
