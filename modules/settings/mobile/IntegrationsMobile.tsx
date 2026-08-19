import { cookies } from 'next/headers'
import Link from 'next/link'
import type { Route } from 'next'
import { decrypt } from '@/db/auth'
import { db } from '@/config/db'
import { getCalendarConnectionByUserId } from '@/db/googleCalendarConnections'
import { checkFacebookConnection, type FacebookHealthStatus } from '@/lib/facebook/health'
import { GRAPH_VERSION } from '@/lib/facebook/graph'
import { checkMessagingReady } from '@/lib/whatsapp/registration'
import { resolveWhatsappHealth, type WhatsappHealthPrimary } from '@/lib/whatsapp/operationalStatus'
import { getWhatsappConnectionForAgency } from '@/db/whatsapp'
import { isTemplatesEnabledForAgency } from '@/lib/whatsapp/templates/flag'
import { countByStatus } from '@/db/whatsappTemplates'
import WebsiteConnection, { isWebsiteSectionVisible } from '@/components/settings/integrations/WebsiteConnection'
import IntegrationsLanding from './IntegrationsLanding'
import ReadyMessagesScreen from '@/modules/templates/mobile/ReadyMessagesScreen'

type Viewer = { id: number; role: string; agencyId: number }

/**
 * Phone Integrations. Same reads as LeadSourcesSection / ConnectedToolsSection;
 * a different presentation. Deep links `?section=` stay the public contract.
 */
export default async function IntegrationsMobile({
  user,
  activeSection,
}: {
  user: Viewer
  activeSection: string | null
}) {
  const templatesEnabled = isTemplatesEnabledForAgency(user.agencyId)
  const websiteVisible = isWebsiteSectionVisible(user)

  const fbConnection = await db('facebook_pages').where({ user_id: user.id }).first()
  const cookieStore = await cookies()
  const fbPagesCookie = cookieStore.get('fb_pages')?.value
  let pendingPages: { id: string; name: string; access_token: string }[] | null = null
  if (fbPagesCookie) {
    try {
      const payload = await decrypt(fbPagesCookie)
      if (payload?.userId === user.id) pendingPages = payload.pages
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
        pendingPhones = (payload.phones as { id: string; displayPhone: string; verifiedName: string }[]).map(
          ({ id, displayPhone, verifiedName }) => ({ id, displayPhone, verifiedName }),
        )
      }
    } catch {
      // Cookie expired or tampered — ignore
    }
  }

  const counts = templatesEnabled && waConnection ? await countByStatus(user.agencyId) : {}
  const approved = counts.approved ?? 0
  const pending = counts.pending ?? 0
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0)

  const conn = await getCalendarConnectionByUserId(user.id)
  const calendarState: 'not_connected' | 'connected' | 'reauth_required' = !conn
    ? 'not_connected'
    : conn.sync_status === 'reauth_required'
      ? 'reauth_required'
      : conn.sync_status === 'disabled'
        ? 'not_connected'
        : 'connected'

  if (activeSection === 'templates' && templatesEnabled) {
    return (
      <ReadyMessagesScreen
        agencyId={user.agencyId}
        connected={!!waConnection}
        messagingReady={waMessagingReady}
      />
    )
  }

  if (activeSection === 'website' && websiteVisible) {
    return (
      <div className='px-4 pb-8 pt-4'>
        <Link
          href={'/settings/integrations' as Route}
          className='mb-3 inline-flex min-h-11 items-center text-sm font-medium text-primary-text'
        >
          חזרה לאינטגרציות
        </Link>
        <h1 className='mb-3 text-xl font-bold text-ink'>האתר שלי</h1>
        <WebsiteConnection user={user} />
      </div>
    )
  }

  const initialSheet =
    activeSection === 'whatsapp'
      ? 'whatsapp'
      : activeSection === 'facebook'
        ? 'facebook'
        : activeSection === 'google-calendar'
          ? 'calendar'
          : null

  return (
    <IntegrationsLanding
      initialSheet={initialSheet}
      whatsapp={{
        connection: waConnection ? { phoneNumberId: waConnection.phone_number_id } : null,
        pendingPhones,
        appId: process.env.META_APP_ID ?? '',
        configId: process.env.META_EMBEDDED_SIGNUP_CONFIGURATION_ID ?? '',
        graphVersion: GRAPH_VERSION,
        status: waStatus,
      }}
      facebook={{
        connection: fbConnection ? { pageId: fbConnection.page_id, pageName: fbConnection.page_name } : null,
        pendingPages,
        health,
      }}
      templates={{
        enabled: templatesEnabled,
        connected: !!waConnection,
        messagingReady: waMessagingReady,
        total,
        approved,
        pending,
      }}
      calendar={{
        state: calendarState,
        email: conn?.google_email ?? null,
        lastError: conn?.last_error ?? null,
      }}
      websiteVisible={websiteVisible}
    />
  )
}
