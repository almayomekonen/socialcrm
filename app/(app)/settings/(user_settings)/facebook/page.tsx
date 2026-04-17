import { getUser, decrypt } from '@/db/auth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'
import AccordionItem from '@/lib/AccordionItem'
import FacebookConnect from '@/components/settings/FacebookConnect'
import WhatsappConnect from '@/components/settings/WhatsappConnect'
import { checkFacebookConnection, type FacebookHealthStatus } from '@/lib/facebook/health'

export default async function page({ searchParams }) {
  const { error: fbError } = (await searchParams) || {}
  const user = await getUser()

  // Facebook connection
  const fbConnection = await db('facebook_pages').where({ user_id: user.id }).first()

  const cookieStore = await cookies()
  const fbPagesCookie = cookieStore.get('fb_pages')?.value
  let pendingPages: { id: string; name: string; access_token: string }[] | null = null

  if (fbPagesCookie) {
    try {
      const payload = await decrypt(fbPagesCookie)
      if (payload?.userId === user.id) {
        pendingPages = payload.pages
      }
    } catch {
      // Cookie expired or tampered — ignore
    }
  }

  let health: FacebookHealthStatus | null = null
  if (fbConnection) {
    try {
      health = await checkFacebookConnection(fbConnection.page_id, fbConnection.page_access_token)
    } catch {
      // Non-critical
    }
  }

  // WhatsApp connection
  const waConnection = await db('whatsapp_connections').where({ user_id: user.id }).first()

  const waPhonesCookie = cookieStore.get('wa_phones')?.value
  let pendingPhones: { id: string; displayPhone: string; verifiedName: string; accessToken: string }[] | null = null
  if (waPhonesCookie) {
    try {
      const payload = await decrypt(waPhonesCookie)
      if (payload?.userId === user.id) pendingPhones = payload.phones
    } catch {
      // Cookie expired or tampered — ignore
    }
  }

  return (
    <div>
      <h1 className='title'>ערוצי לידים</h1>
      <div className='my-6 max-w-lg'>
        <div className='accordion border rounded-lg bg-white'>
          <AccordionItem
            bodyClass='p-6'
            title='פייסבוק'
            icon='facebook'
            open={!!fbConnection || !!pendingPages || !!fbError}
          >
            <FacebookConnect
              connection={fbConnection ? { pageId: fbConnection.page_id, pageName: fbConnection.page_name } : null}
              pendingPages={pendingPages}
              health={health}
            />
          </AccordionItem>
          <AccordionItem bodyClass='p-6' title='וואטסאפ ממש בקרוב...' icon='whatsapp'>
            <WhatsappConnect
              connection={waConnection ? { phoneNumberId: waConnection.phone_number_id } : null}
              pendingPhones={pendingPhones}
            />
          </AccordionItem>
        </div>
      </div>
    </div>
  )
}
