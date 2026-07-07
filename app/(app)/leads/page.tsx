import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { getLeadLists, getLeadsTable, getGlobalLatestUpdatedAt, hasAnyLeads } from '@/db/clients'
import { Metadata } from 'next'
import ClientsTable from '@/components/clients/clientsTable'
import LeadsFirstRun from '@/components/clients/LeadsFirstRun'
import { Provider } from '@/lib/hooksNEvents'
import { getPerms } from '@/db/filter'
import { getDefaultSettings, getUsers } from '@/db/usersNTeams'
import { getQuotaStatus } from '@/lib/quota'
import OverQuotaBanner from '@/components/quota/OverQuotaBanner'
import MetaDisconnectedBanner from '@/components/clients/MetaDisconnectedBanner'
import WelcomeToast from '@/components/auth/WelcomeToast'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState } from '@/lib/trial'
import { getFacebookConnectionState } from '@/db/facebook'

export const metadata: Metadata = {
  title: 'נתוני לידים',
  description: 'כל נתוני הלידים',
}

export default async function LeadsPage({ searchParams }) {
  const params = (await searchParams) || {}
  const user = await getUser()
  const [handlers, settings, clientLists, globalLatestUpdatedAt, allUsers, quota, trialRow, meta] = await Promise.all([
    getPerms(user),
    getDefaultSettings(user.id),
    getLeadLists(user.id),
    getGlobalLatestUpdatedAt(),
    getUsers({ withOfficeUsers: true, withExtUsers: true }),
    getQuotaStatus(user.agencyId),
    getAgencyTrial(user.agencyId),
    getFacebookConnectionState(user.id),
  ])
  // The Welcome Trial Modal is the welcome for NEVER_STARTED users — the
  // toast greeting is suppressed (one welcome, one state); pixel still fires.
  const suppressGreeting = trialRow ? getTrialState(trialRow, new Date()).status === 'NEVER_STARTED' : false
  // Empty *system* state (no leads at all) is decided at the page level, ignoring
  // any active filter — ux-guidelines §11. When the account is truly empty we
  // render only the first-run onboarding, never the table chrome. hasAnyLeads
  // ignores params, so a filter that returns 0 on a populated account still shows
  // the full table (with its in-table empty state).
  const hasLeads = await hasAnyLeads(user.agencyId, handlers.gotPermIds, user.role)
  const clients = hasLeads
    ? await getLeadsTable({ user, params, leads: true, gotPermIds: handlers.gotPermIds, settings })
    : []
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
          <MetaDisconnectedBanner show={meta.needsReconnect} />
          <OverQuotaBanner count={quota.overQuotaCount} />
          <Suspense fallback={null}>
            <ClientsTable leads={true} fillHeight data={clients} user={user} globalLatestUpdatedAt={globalLatestUpdatedAt} formProps={formProps} key={params.clientId ?? 'all'} />
          </Suspense>
        </>
      ) : (
        <LeadsFirstRun metaConnected={meta.connected && !meta.needsReconnect} />
      )}
    </Provider>
  )
}
