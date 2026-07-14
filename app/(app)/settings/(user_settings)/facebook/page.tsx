import { Suspense } from 'react'
import { getUser, decrypt } from '@/db/auth'
import { db } from '@/config/db'
import { cookies } from 'next/headers'
import AccordionItem from '@/lib/AccordionItem'
import UrlSyncedAccordion from '@/lib/UrlSyncedAccordion'
import { MetaLeadAdsBadge, WhatsappBadge } from '@/components/ui/MetaLeadAdsBadge'
import FacebookConnect from '@/components/settings/FacebookConnect'
import WhatsappConnect from '@/components/settings/WhatsappConnect'
import { checkFacebookConnection, type FacebookHealthStatus } from '@/lib/facebook/health'
import { GRAPH_VERSION } from '@/lib/facebook/graph'
import { checkMessagingReady } from '@/lib/whatsapp/registration'

export default async function page({ searchParams }) {
  // Deep-link support: /settings/facebook?section=whatsapp opens that section.
  // Read server-side so refresh + Back/Forward preserve it with no client state.
  // No param keeps today's default (Facebook open). Generic — a future section
  // just needs its own AccordionItem with open={activeSection === '<id>'}.
  const { section } = (await searchParams) || {}
  const activeSection = typeof section === 'string' ? section : null
  const openFacebook = activeSection ? activeSection === 'facebook' : true
  const openWhatsapp = activeSection === 'whatsapp'

  const user = await getUser()

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

  const waConnection = await db('whatsapp_connections').where({ user_id: user.id }).first()

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
        <UrlSyncedAccordion className='accordion border rounded-lg bg-white'>
          <AccordionItem id='facebook' bodyClass='p-6' title='פייסבוק ואינסטגרם' iconNode={<MetaLeadAdsBadge size='sm' />} open={openFacebook}>
            <Suspense fallback={null}>
              <FacebookConnect
                connection={fbConnection ? { pageId: fbConnection.page_id, pageName: fbConnection.page_name } : null}
                pendingPages={pendingPages}
                health={health}
              />
            </Suspense>
          </AccordionItem>
          <AccordionItem id='whatsapp' bodyClass='p-6' title='וואטסאפ' iconNode={<WhatsappBadge size='sm' />} open={openWhatsapp}>
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
        </UrlSyncedAccordion>
      </div>
    </div>
  )
}
