import { getUser } from '@/db/auth'
import { getIssuer } from '@/db/billing/issuer'
import EditAgency from '@/components/settings/agency/EditAgency'
import BusinessProfileArt from '@/components/settings/agency/BusinessProfileArt'

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
      {/*
        The frame is 10px of breathing room around a 940×280 scene, which is
        the reference's 300px band at full width and keeps that proportion as
        the column narrows. `mb-8` is the reference's 32px gap to the title;
        nothing below this line changed.

        Hidden on phones: the scene would scale to about a third of its size
        there, where the labels stop being readable and it would only push the
        form itself further down.
      */}
      <div className='mb-8 flex justify-center overflow-hidden rounded-[14px] bg-[#f7f8fa] py-2.5 mobile:hidden'>
        {/* Only Google sign-in fills `picture`; the art falls back to the
            drawn avatar when it is empty. */}
        <BusinessProfileArt photoUrl={user.picture} />
      </div>
      <h1 className='title mb-8'>פרטי העסק</h1>
      <div className='mb-6 max-w-2xl'>
        <EditAgency issuer={issuer} />
      </div>
    </div>
  )
}
