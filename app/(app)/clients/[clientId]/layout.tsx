import { getUser } from '@/db/auth'
import ClientHeader from '@/components/clientPage/ClientHeader'
import ClientNav from '@/components/clientPage/ClientNav'
import { getFullLead, getFamMembers } from '@/db/clients'
import { getUserNameById } from '@/db/usersNTeams'
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

  const handlerName = await getUserNameById(client?.handlerId)

  const family = (await getFamMembers(clientId)).famMembers

  return (
    <div className='mb-8 '>
      <ClientHeader client={client} user={user} handlerName={handlerName} family={family} clientId={clientId} />
      <ClientNav id={clientId} />
      {children}
    </div>
  )
}
