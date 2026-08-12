import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import ClientHeader from '@/components/clientPage/ClientHeader'
import ClientNav from '@/components/clientPage/ClientNav'
import { getFullLead, getFamMembers } from '@/db/clients'
import { getUserNameById, getUsers } from '@/db/usersNTeams'
import { getPerms } from '@/db/filter'
import CopilotLeadContext from '@/components/copilot/CopilotLeadContext'
import { Metadata } from 'next'
import { isMobileRequest } from '@/lib/device'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'

export const metadata: Metadata = {
  title: 'נתוני ליד',
  description: 'כל נתוני הליד',
}

export default async function layout({ children, params }) {
  const { clientId } = await params
  const user = await getUser()

  /**
   * MOBILE LEAD DETAIL (Phase A). The desktop ClientHeader + four-tab ClientNav
   * + Copilot context are never rendered on a phone. The summary page supplies
   * its own presentation; other client sub-routes still render their children
   * inside the mobile shell (back arrow, no second nav).
   */
  if ((await isMobileRequest()) && canEnterMobileWorkspace(user?.agencyId)) {
    return children
  }

  const client = await getFullLead({
    id: clientId,
    select: ['name', 'rank', 'birthDate', 'gender', 'familyStatus', 'email', 'phone', 'secPhone', 'handlerId'],
  })

  if (!client?.name) return <div>ליד זה לא נמצא</div>

  const [handlerName, family, perms, allUsers] = await Promise.all([
    getUserNameById(client?.handlerId),
    getFamMembers(clientId).then((r) => r.famMembers),
    getPerms(user),
    getUsers({ withOfficeUsers: true, withExtUsers: true }),
  ])

  const formProps = { user, officeGotPerm: perms.gotPermUsers, allUsers }

  return (
    <div className='mb-8 '>
      <ClientHeader
        client={client}
        user={user}
        handlerName={handlerName}
        family={family}
        clientId={clientId}
        formProps={formProps}
      />
      <ClientNav id={clientId} />
      {children}
      <Suspense fallback={null}>
        <CopilotLeadContext leadId={clientId} />
      </Suspense>
    </div>
  )
}
