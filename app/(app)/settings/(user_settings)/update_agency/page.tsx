import { getUser } from '@/db/auth'
import { getIssuer } from '@/db/billing/issuer'
import EditAgency from '@/components/settings/agency/EditAgency'

export default async function page() {
  const user = await getUser()
  if (!user || user.role != 'ADMIN') {
    return <div>אין לך הרשאה לצפות בדף זה</div>
  }

  const issuer = await getIssuer(user.agencyId)
  if (!issuer) {
    return <div>שגיאה בטעינת פרטי העסק</div>
  }

  return (
    <div>
      <h1 className='title'>פרטי העסק</h1>
      <div className=' my-6 max-w-2xl'>
        <EditAgency issuer={issuer} />
      </div>
    </div>
  )
}
