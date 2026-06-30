import { Suspense } from 'react'
import { getUser, decrypt } from '@/db/auth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'
import AccordionItem from '@/lib/AccordionItem'
import FacebookConnect from '@/components/settings/FacebookConnect'
import WhatsappConnect from '@/components/settings/WhatsappConnect'
import { checkFacebookConnection, type FacebookHealthStatus } from '@/lib/facebook/health'
import { GRAPH_VERSION } from '@/lib/facebook/graph'
import { checkMessagingReady } from '@/lib/whatsapp/registration'

export default async function page() {
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

  // Live readiness check — a connected row does not guarantee the number is
  // registered for Cloud API, so never show "active" without verifying status.
  let waMessagingReady = true
  if (waConnection) {
    waMessagingReady = await checkMessagingReady(waConnection.phone_number_id, waConnection.access_token)
  }

  const waPhonesCookie = cookieStore.get('wa_phones')?.value
  let pendingPhones: { id: string; displayPhone: string; verifiedName: string }[] | null = null
  if (waPhonesCookie) {
    try {
      const payload = await decrypt(waPhonesCookie)
      if (payload?.userId === user.id) {
        // Strip the access token — the client receives display data only. The
        // token stays in the server-only httpOnly cookie; the connect route
        // resolves it server-side.
        pendingPhones = (payload.phones as { id: string; displayPhone: string; verifiedName: string }[]).map(
          ({ id, displayPhone, verifiedName }) => ({ id, displayPhone, verifiedName }),
        )
      }
    } catch {
      // Cookie expired or tampered — ignore
    }
  }

  return (
    <div>
      <h1 className='title'>ערוצי לידים</h1>
      <div className='my-6 max-w-lg'>
        <div className='accordion border rounded-lg bg-white'>
          <AccordionItem bodyClass='p-6' title='פייסבוק' icon='facebook' open={true}>
            <Suspense fallback={null}>
              <FacebookConnect
                connection={fbConnection ? { pageId: fbConnection.page_id, pageName: fbConnection.page_name } : null}
                pendingPages={pendingPages}
                health={health}
              />
            </Suspense>
          </AccordionItem>
          <AccordionItem bodyClass='p-6' title='וואטסאפ' icon='whatsapp'>
            <Suspense fallback={null}>
              <WhatsappConnect
                connection={waConnection ? { phoneNumberId: waConnection.phone_number_id } : null}
                pendingPhones={pendingPhones}
                appId={process.env.META_APP_ID ?? ''}
                configId={process.env.META_EMBEDDED_SIGNUP_CONFIGURATION_ID ?? ''}
                graphVersion={GRAPH_VERSION}
                messagingReady={waMessagingReady}
              />
            </Suspense>
          </AccordionItem>
        </div>
      </div>
    </div>
  )
}
