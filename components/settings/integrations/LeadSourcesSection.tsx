import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { decrypt } from '@/db/auth'
import { db } from '@/config/db'
import AccordionItem from '@/lib/AccordionItem'
import UrlSyncedAccordion from '@/lib/UrlSyncedAccordion'
import FacebookConnect from '@/components/settings/FacebookConnect'
import WhatsappConnect from '@/components/settings/WhatsappConnect'
import { checkFacebookConnection, type FacebookHealthStatus } from '@/lib/facebook/health'
import { resolvePageAccessToken } from '@/lib/facebook/pageToken'
import { PENDING_PAGES_COOKIE, readPendingPages, toClientPages } from '@/lib/facebook/pendingPages'
import { getFacebookCommentTextCapability } from '@/db/facebook'
import { isFacebookCommentsEnabledForAgency } from '@/lib/facebook/comments/capability'
import { GRAPH_VERSION } from '@/lib/facebook/graph'
import { checkMessagingReady } from '@/lib/whatsapp/registration'
import { resolveWhatsappHealth, type WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'
import { getWhatsappConnectionForAgency } from '@/db/whatsapp'
import { getInAppBrowser } from '@/lib/device'
import TemplatesSection, { TemplatesHeaderBadge } from '@/components/settings/templates/TemplatesSection'
import { isTemplatesEnabledForAgency } from '@/lib/whatsapp/templates/flag'
import MessengerEntryPoints from '@/components/settings/messenger/MessengerEntryPoints'
import { loadMessengerSection } from '@/components/settings/messenger/messengerSectionData'
import WebsiteConnection, { isWebsiteSectionVisible } from './WebsiteConnection'
import { BRAND } from './brandColors'

/**
 * מקורות לידים — every system that, by being connected, causes new לידים to
 * appear in the CRM on its own.
 *
 * This is the former `/settings/facebook` page body plus the website
 * connectors that used to live on `/settings/connections`. The connect
 * components themselves are untouched; only the composition moved, so the
 * shipped Facebook / WhatsApp / templates behaviour is carried over exactly.
 *
 * SECTION IDS ARE A PUBLIC CONTRACT. `facebook`, `whatsapp` and `templates`
 * are reachable from OAuth callbacks, in-app CTAs and customer emails that
 * have already been delivered — one of them is a hardcoded absolute URL in
 * `lib/emailAutomations/announcements/whatsappTemplates.ts`. They must keep
 * resolving to the same section forever; `website` is the only new id.
 */

type Viewer = { id: number; role: string; agencyId: number }

export default async function LeadSourcesSection({
  user,
  activeSection,
}: {
  user: Viewer
  activeSection: string | null
}) {
  const templatesEnabled = isTemplatesEnabledForAgency(user.agencyId)
  const websiteVisible = isWebsiteSectionVisible(user)

  // No param keeps the shipped default (Facebook open). Any other value opens
  // exactly that section, and an unknown value opens none.
  const openFacebook = activeSection ? activeSection === 'facebook' : true
  const openWhatsapp = activeSection === 'whatsapp'
  const openTemplates = activeSection === 'templates'
  const openWebsite = activeSection === 'website'

  // Facebook connection
  const fbConnection = await db('facebook_pages').where({ user_id: user.id }).first()

  const cookieStore = await cookies()
  // Display data only: `{ id, name }`. Page tokens stay in the server-only
  // cookie and /connect resolves them server-side — same rule as `wa_phones`.
  const pendingPages = toClientPages(await readPendingPages(cookieStore.get(PENDING_PAGES_COOKIE)?.value, user.id))

  let health: FacebookHealthStatus | null = null
  if (fbConnection) {
    try {
      health = await checkFacebookConnection(fbConnection.page_id, resolvePageAccessToken(fbConnection.page_access_token))
    } catch {
      // Non-critical
    }
  }

  /**
   * Comment-text reconnect prompt. BOTH gates must hold: our rollout switch for
   * this agency, and Meta's grant recorded on the Page row. An agency without
   * the Comments feature is never shown a permission it cannot use, and no
   * Graph call is made — this reads one already-loaded column.
   */
  let commentsNeedReconnect = false
  if (fbConnection && isFacebookCommentsEnabledForAgency(user.agencyId)) {
    try {
      commentsNeedReconnect = (await getFacebookCommentTextCapability(user.agencyId)).needsReconnect
    } catch {
      // Non-critical — a failed capability read must never break the settings page.
    }
  }

  // WhatsApp connection — agency-scoped. A persisted row is NOT proof the
  // integration works (see resolveWhatsappHealth). TemplatesSection keeps the
  // phone-level readiness boolean below.
  const waConnection = await getWhatsappConnectionForAgency(user.agencyId)

  let waMessagingReady = true
  let waStatus: WhatsappHealthPrimary = 'disconnected'
  if (waConnection) {
    waMessagingReady = await checkMessagingReady(waConnection.phone_number_id, waConnection.access_token)
    waStatus = (await resolveWhatsappHealth(waConnection, user.agencyId)).primary
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

  const inAppBrowser = await getInAppBrowser()

  const messenger = await loadMessengerSection(user, fbConnection)

  return (
    <UrlSyncedAccordion className='accordion border rounded-lg bg-white'>
      <AccordionItem
        id='facebook'
        edu='facebook-section'
        bodyClass='p-6'
        title='פייסבוק'
        icon='facebook'
        iconClassName={BRAND.facebook}
        open={openFacebook}
      >
        <Suspense fallback={null}>
          <FacebookConnect
            connection={fbConnection ? { pageId: fbConnection.page_id, pageName: fbConnection.page_name } : null}
            pendingPages={pendingPages}
            health={health}
            commentsNeedReconnect={commentsNeedReconnect}
            inAppBrowser={inAppBrowser}
          />
        </Suspense>
      </AccordionItem>
      <AccordionItem
        id='whatsapp'
        edu='whatsapp-section'
        bodyClass='p-6'
        title='וואטסאפ'
        icon='whatsapp'
        iconClassName={BRAND.whatsapp}
        open={openWhatsapp}
      >
        <Suspense fallback={null}>
          <WhatsappConnect
            connection={waConnection ? { phoneNumberId: waConnection.phone_number_id } : null}
            pendingPhones={pendingPhones}
            appId={process.env.META_APP_ID ?? ''}
            configId={process.env.META_EMBEDDED_SIGNUP_CONFIGURATION_ID ?? ''}
            graphVersion={GRAPH_VERSION}
            status={waStatus}
            inAppBrowser={inAppBrowser}
          />
        </Suspense>
      </AccordionItem>
      {messenger.visible && (
        <AccordionItem
          id='messenger'
          bodyClass='p-6'
          title='הודעת פתיחה ותפריט ב-Messenger'
          icon='facebook'
          iconClassName={BRAND.facebook}
        >
          <Suspense fallback={null}>
            <MessengerEntryPoints
              pageId={messenger.pageId}
              initial={messenger.profile}
              readFailed={messenger.readFailed}
            />
          </Suspense>
        </AccordionItem>
      )}
      {templatesEnabled && (
        <AccordionItem
          id='templates'
          bodyClass='p-6'
          title='הודעות WhatsApp מוכנות'
          icon='whatsapp'
          iconClassName={BRAND.templates}
          open={openTemplates}
          badge={
            <Suspense fallback={null}>
              <TemplatesHeaderBadge agencyId={user.agencyId} connected={!!waConnection} />
            </Suspense>
          }
        >
          <Suspense fallback={null}>
            <TemplatesSection agencyId={user.agencyId} connected={!!waConnection} messagingReady={waMessagingReady} />
          </Suspense>
        </AccordionItem>
      )}
      {websiteVisible && (
        <AccordionItem
          id='website'
          bodyClass='p-6'
          title='האתר שלי'
          icon='globe'
          iconClassName={BRAND.website}
          open={openWebsite}
        >
          <Suspense fallback={null}>
            <WebsiteConnection user={user} />
          </Suspense>
        </AccordionItem>
      )}
    </UrlSyncedAccordion>
  )
}
