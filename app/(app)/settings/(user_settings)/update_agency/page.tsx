import { getUser } from '@/db/auth'
import { getAgencyById } from '@/db/agencies'
import EditAgency from '@/components/settings/agency/EditAgency'

export default async function page() {
  const user = await getUser()
  if (user.role != 'ADMIN') {
    return <div>אין לך הרשאה לצפות בדף זה</div>
  }
  const agency = await getAgencyById(user.agencyId)

  return (
    <div>
      <h1 className='title'>פרטי העסק</h1>
      <div className=' my-6 max-w-2xl'>
        <EditAgency agency={agency} />
      </div>
    </div>
  )
}
