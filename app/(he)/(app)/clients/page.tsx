import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { getLeadLists, getLeadsTable, getGlobalLatestUpdatedAt, getLeadColumnAvailability } from '@/db/clients'
import { Metadata } from 'next'
import ClientsTable from '@/components/clients/clientsTable'
import { Provider } from '@/lib/hooksNEvents'
import { getPerms } from '@/db/filter'
import { getDefaultSettings, getUsers } from '@/db/usersNTeams'
import { getQuotaStatus } from '@/lib/quota'
import { getWhatsappConnectionState } from '@/db/whatsapp'
import OverQuotaBanner from '@/components/quota/OverQuotaBanner'
import { isMobileWorkspaceRequest } from '@/lib/device'
import { parseLeadFilters } from '@/modules/leads/filters'
import MobileDesktopOnly from '@/components/mobile/MobileDesktopOnly'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/** Tab title in the interface language — Hebrew ('נתוני לקוחות') outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('leads.page.clientsTitle'), description: t('leads.page.clientsDescription') }
}

export default async function ClientsPage({ searchParams }) {
  const params = (await searchParams) || {}
  const user = await getUser()

  /**
   * DESKTOP-ONLY SECTION — this LIST page only.
   *
   * `/clients/[clientId]/summary` is a fully built mobile lead-detail screen and
   * must keep working; the gate therefore lives here, on the list page, and NOT
   * in `clients/layout.tsx`, which wraps both. Returned before the six parallel
   * reads and `ClientsTable` (architecture-rules.md §9).
   */
  if (await isMobileWorkspaceRequest(user?.agencyId)) return <MobileDesktopOnly section='clients' />

  const { locale } = await getUiLocaleState(user)
  const t = translatorFor(locale)
  const [handlers, settings, clientLists, globalLatestUpdatedAt, allUsers, quota, wa] = await Promise.all([
    getPerms(user),
    getDefaultSettings(user.id),
    getLeadLists(user.id),
    getGlobalLatestUpdatedAt(),
    getUsers({ withOfficeUsers: true, withExtUsers: true }),
    getQuotaStatus(user.agencyId),
    // `/clients` renders the SAME ClientsTable and therefore the same
    // lead-contact action; without this its WhatsApp control would resolve
    // `whatsappConnected` as undefined and silently keep the old behaviour while
    // /leads had the new one. One doctrine means both pages supply it.
    getWhatsappConnectionState(user.agencyId),
  ])
  // Same search model as /leads — see the note there. `/clients` shares
  // `ClientsTable`, so it must consume `q` too or its search silently stops
  // filtering the moment the toolbar starts writing it.
  const search = parseLeadFilters(params).q
  const clients = await getLeadsTable({
    user,
    params,
    leads: false,
    gotPermIds: handlers.gotPermIds,
    settings,
    filters: search ? { q: search } : null,
  })
  const columnAvailability = await getLeadColumnAvailability({ user, leads: false, gotPermIds: handlers.gotPermIds })
  const formProps = { user, officeGotPerm: handlers.gotPermUsers, allUsers }
  return (
    <Provider
      props={{
        tableLength: clients.length,
        params,
        clientLists,
        clients,
        handlers: handlers.allPermUsers,
        users: handlers.allPermUsers,
      }}
      className='flex flex-col min-h-0 h-full'
      regionAttrs={regionAttrs(locale)}
    >
      <p className='text-sm text-gray-500 mb-2 shrink-0'>{t('leads.page.clientsExplainer')}</p>

      <OverQuotaBanner count={quota.overQuotaCount} />

      <Suspense fallback={null}>
        <ClientsTable leads={false} fillHeight data={clients} user={user} globalLatestUpdatedAt={globalLatestUpdatedAt} formProps={formProps} columnAvailability={columnAvailability} whatsappConnected={wa.connected} />
      </Suspense>
    </Provider>
  )
}
