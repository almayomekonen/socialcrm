import { getUser, decrypt } from '@/db/auth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'
import AccordionItem from '@/lib/AccordionItem'
import FacebookConnect from '@/components/settings/FacebookConnect'
import { checkFacebookConnection, type FacebookHealthStatus } from '@/lib/facebook/health'

export default async function page() {
  const user = await getUser()

  const connection = await db('facebook_pages').where({ user_id: user.id }).first()

  // Read pending pages from the short-lived cookie set after OAuth callback
  const cookieStore = await cookies()
  const fbPagesCookie = cookieStore.get('fb_pages')?.value
  let pendingPages: { id: string; name: string; access_token: string }[] | null = null

  if (fbPagesCookie) {
    try {
      const payload = await decrypt(fbPagesCookie)
      // Ensure the cookie belongs to this user (prevents session-swap)
      if (payload?.userId === user.id) {
        pendingPages = payload.pages
      }
    } catch {
      // Cookie expired or tampered — ignore, show default state
    }
  }

  // Run health check server-side if a connection exists
  let health: FacebookHealthStatus | null = null
  if (connection) {
    try {
      health = await checkFacebookConnection(connection.page_id, connection.page_access_token)
    } catch {
      // Non-critical — page still renders without health data
    }
  }

  return (
    <div>
      <h1 className='title'>חיבור פייסבוק</h1>
      <div className='accordion border rounded-lg my-6 max-w-3xl bg-white'>
        <AccordionItem bodyClass='p-6' title='חיבור דף פייסבוק' open>
          <FacebookConnect
            connection={connection ? { pageId: connection.page_id, pageName: connection.page_name } : null}
            pendingPages={pendingPages}
            health={health}
          />
        </AccordionItem>
      </div>
    </div>
  )
}
