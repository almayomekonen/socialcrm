import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { getLeadLists, getLeadsTable, getGlobalLatestUpdatedAt, hasAnyLeads, getLeadColumnAvailability } from '@/db/clients'
import { Metadata } from 'next'
import ClientsTable from '@/components/clients/clientsTable'
import LeadsFirstRun from '@/components/clients/LeadsFirstRun'
import { Provider } from '@/lib/hooksNEvents'
import { getPerms } from '@/db/filter'
import { getDefaultSettings, getUsers } from '@/db/usersNTeams'
import { getQuotaStatus } from '@/lib/quota'
import OverQuotaBanner from '@/components/quota/OverQuotaBanner'
import MetaDisconnectedBanner from '@/components/clients/MetaDisconnectedBanner'
import LeadIntakeBanner from '@/components/clients/LeadIntakeBanner'
import CrmSyncBanner from '@/components/clients/CrmSyncBanner'
import WelcomeToast from '@/components/auth/WelcomeToast'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState } from '@/lib/trial'
import { getFacebookConnectionState } from '@/db/facebook'
import { getWhatsappConnectionState } from '@/db/whatsapp'
import { intakeAlerts } from '@/lib/automations/connectors/intakeAlerts'

export const metadata: Metadata = {
  title: 'נתוני לידים',
  description: 'כל נתוני הלידים',
}

export default async function LeadsPage({ searchParams }) {
  const params = (await searchParams) || {}
  const user = await getUser()
  const [handlers, settings, clientLists, globalLatestUpdatedAt, allUsers, quota, trialRow, meta, wa, intake] = await Promise.all([
    getPerms(user),
    getDefaultSettings(user.id),
    getLeadLists(user.id),
    getGlobalLatestUpdatedAt(),
    getUsers({ withOfficeUsers: true, withExtUsers: true }),
    getQuotaStatus(user.agencyId),
    getAgencyTrial(user.agencyId),
    getFacebookConnectionState(user.id),
    getWhatsappConnectionState(user.id),
    intakeAlerts(user.agencyId),
  ])

  const suppressGreeting = trialRow ? getTrialState(trialRow, new Date()).status === 'NEVER_STARTED' : false

  const hasLeads = await hasAnyLeads(user.agencyId, handlers.gotPermIds, user.role)
  const clients = hasLeads
    ? await getLeadsTable({ user, params, leads: true, gotPermIds: handlers.gotPermIds, settings })
    : []
  const columnAvailability = hasLeads
    ? await getLeadColumnAvailability({ user, leads: true, gotPermIds: handlers.gotPermIds })
    : null
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
    >
      <WelcomeToast suppressGreeting={suppressGreeting} />

      {hasLeads ? (
        <>
          <div data-alert-region='crm-sync' className='shrink-0'>
            <MetaDisconnectedBanner show={meta.needsReconnect} />
            {/* A lead source that is refusing what arrives — same surface, same
                consequence, same shape as the Meta banner above it. */}
            <LeadIntakeBanner alerts={intake} />
            <OverQuotaBanner count={quota.overQuotaCount} />
            <CrmSyncBanner sources={['leads', 'awareness']} />
          </div>
          <Suspense fallback={null}>
            <ClientsTable leads={true} fillHeight data={clients} user={user} globalLatestUpdatedAt={globalLatestUpdatedAt} formProps={formProps} columnAvailability={columnAvailability} key={params.clientId ?? 'all'} />
          </Suspense>
        </>
      ) : (
        <LeadsFirstRun metaConnected={meta.connected && !meta.needsReconnect} whatsappConnected={wa.connected} />
      )}
    </Provider>
  )
}
