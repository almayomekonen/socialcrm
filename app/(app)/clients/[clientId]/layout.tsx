import { getUser } from '@/db/auth'
import ClientHeader from '@/components/clientPage/ClientHeader'
import ClientNav from '@/components/clientPage/ClientNav'
import { getFullLead, getFamMembers } from '@/db/clients'
import { getUserNameById, getUsers } from '@/db/usersNTeams'
import { getPerms } from '@/db/filter'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'נתוני ליד',
  description: 'כל נתוני הליד',
}

export default async function layout({ children, params }) {
  const { clientId } = await params
  const user = await getUser()

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
    </div>
  )
}
