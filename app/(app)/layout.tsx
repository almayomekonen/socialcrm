import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { getAgencyById } from '@/db/agencies'
import Topbar from '@/lib/navs/Topbar'
import Nav from '@/lib/navs/Nav'
import { PosProvider, UserProvider } from '@/lib/hooksNEvents'
import { redirect } from 'next/navigation'
// 1. Move the async data fetching into a separate component
async function LayoutContent({ children }) {
  const user = await getUser()
  if (!user) redirect('/auth')
  let agency = null
  if (user) agency = await getAgencyById(user?.agencyId)

  return (
    <UserProvider user={user}>
      <PosProvider>
        <div className='desktop:grid grid-cols-[50px_1fr]'>
          <Nav user={user} />
          <div>
            <Topbar user={user} />
            <main className='wrap mt-2'>{children}</main>
          </div>
        </div>
      </PosProvider>
    </UserProvider>
  )
}

// 2. The main layout acts as a shell that suspends the content
export default function AppLayout({ children }) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LayoutContent>{children}</LayoutContent>
    </Suspense>
  )
}
