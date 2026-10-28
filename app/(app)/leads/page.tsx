import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import { getLeadLists, getLeadsTable, getGlobalLatestUpdatedAt, hasAnyLeads, getLeadColumnAvailability } from '@/db/clients'
import { Metadata } from 'next'
import ClientsTable from '@/components/clients/clientsTable'
import LeadsFirstRun from '@/components/clients/LeadsFirstRun'
import FirstImportCallout from '@/components/clients/FirstImportCallout'
import { Provider } from '@/lib/hooksNEvents'
import { getPerms } from '@/db/filter'
import { getDefaultSettings, getUsers } from '@/db/usersNTeams'
import { getQuotaStatus } from '@/lib/quota'
import OverQuotaBanner from '@/components/quota/OverQuotaBanner'
import MetaDisconnectedBanner from '@/components/clients/MetaDisconnectedBanner'
import LeadIntakeBanner from '@/components/clients/LeadIntakeBanner'
import CrmSyncBanner from '@/components/clients/CrmSyncBanner'
import WelcomeParamCleanup from '@/components/auth/WelcomeParamCleanup'
import { getFacebookConnectionState } from '@/db/facebook'
import { getWhatsappConnectionState } from '@/db/whatsapp'
import { intakeAlerts } from '@/lib/automations/connectors/intakeAlerts'
import { isMobileRequest } from '@/lib/device'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'
import { parseLeadFilters } from '@/modules/leads/filters'
import { getMobileLeadList, agencyHasAnyLeads } from '@/modules/leads/queries'
import LeadListMobile from '@/modules/leads/mobile/LeadListMobile'
import AutoTour from '@/components/education/AutoTour'
import { pipelineYieldsToFirstImport } from '@/lib/education'

export const metadata: Metadata = {
  title: 'נתוני לידים',
  description: 'כל נתוני הלידים',
}

export default async function LeadsPage({ searchParams }) {
  const params = (await searchParams) || {}
  const user = await getUser()

  /**
   * MOBILE LEAD LIST (Phase A). `ClientsTable` — 586 lines, a column manager,
   * five dialogs, a paginated footer — is never rendered on a phone. The mobile
   * branch is a dedicated card list over the SAME `getLeadsTable` query, with
   * search and status filtering pushed into SQL and held in the URL.
   *
   * Gated SERVER-SIDE and returned BEFORE the ten desktop queries below, so a
   * phone does no wasted work and receives no desktop markup at all
   * (architecture-rules.md §9: prevention by absence). Desktop never reaches
   * this branch and its query path is unchanged.
   */
  if ((await isMobileRequest()) && canEnterMobileWorkspace(user.agencyId)) {
    const filters = parseLeadFilters(params)
    const page = Math.max(1, Number(params.page) || 1)
    const [list, workspaceHasLeads] = await Promise.all([
      getMobileLeadList(user, filters, page),
      agencyHasAnyLeads(user),
    ])
    // WhatsApp state is resolved UNCONDITIONALLY, not just for the empty
    // workspace. The contact action needs it on every row: a workspace WITH
    // leads is exactly where contacting happens, and defaulting it to `false`
    // there would route a connected agency — the one case that already works —
    // to the native handoff instead of its real in-app conversation.
    // Facebook state stays inside the branch; only first-run reads it.
    const wa =
      user.agencyId != null ? await getWhatsappConnectionState(user.agencyId) : { connected: false }
    const whatsappConnected = wa.connected
    let metaConnected = false
    if (!workspaceHasLeads) {
      const meta = await getFacebookConnectionState(user.id)
      metaConnected = meta.connected && !meta.needsReconnect
    }
    return (
      <LeadListMobile
        /* The import redirect lands here on a phone as well. Without these the
           mobile list showed the imported leads with no banner and no route
           into the first-lead flow — the exact "unexplained table" state the
           callout exists to prevent, on the surface most signups arrive from. */
        firstImport={Number(params.firstImport) || 0}
        firstLeadId={Number(params.firstLeadId) || undefined}
        firstImportSkipped={Number(params.firstImportSkipped) || 0}
        rows={list.rows}
        filters={filters}
        hasMore={list.hasMore}
        page={list.page}
        // Filtered-empty is NOT system-empty (ux-guidelines.md §11): the two
        // states get different copy and different actions, so the list needs to
        // know which one it is in.
        workspaceEmpty={!workspaceHasLeads}
        nowMs={Date.now()}
        metaConnected={metaConnected}
        whatsappConnected={whatsappConnected}
      />
    )
  }

  const [handlers, settings, clientLists, globalLatestUpdatedAt, allUsers, quota, meta, wa, intake] = await Promise.all([
    getPerms(user),
    getDefaultSettings(user.id),
    getLeadLists(user.id),
    getGlobalLatestUpdatedAt(),
    getUsers({ withOfficeUsers: true, withExtUsers: true }),
    getQuotaStatus(user.agencyId),
    getFacebookConnectionState(user.id),
    getWhatsappConnectionState(user.agencyId),
    intakeAlerts(user.agencyId),
  ])

  const hasLeads = await hasAnyLeads(user.agencyId, handlers.gotPermIds, user.role)
  /**
   * DESKTOP SEARCH. The toolbar search writes `?q=` and the workspace narrows
   * through the SAME filter the mobile list uses — one search model, two
   * presentations. `parseLeadFilters` does the validation (trimmed, capped).
   *
   * Only `q` is forwarded, never `status`: desktop's status tabs are a
   * client-side control with no chrome to explain a URL-driven status narrowing,
   * and a filter the user cannot see is the bug this whole change exists to
   * remove. Desktop opts in deliberately — see the note in `db/clients.ts`.
   */
  const search = parseLeadFilters(params).q
  const clients = hasLeads
    ? await getLeadsTable({
        user,
        params,
        leads: true,
        gotPermIds: handlers.gotPermIds,
        settings,
        filters: search ? { q: search } : null,
      })
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
      <WelcomeParamCleanup />

      {hasLeads ? (
        <>
          {/* The tour yields while the import handoff owns the screen, so its
              overlay cannot cover `פתח את הליד הראשון`. Deferred, not cancelled:
              it starts on the next /leads visit once the params are gone. */}
          {/* Also yields while ?add=1 / ?import=1 (the Today hero's buttons) opens
              its dialog, so the tour never stacks on top of the requested one. */}
          <AutoTour
            id='pipeline'
            enabled={!pipelineYieldsToFirstImport(Number(params.firstImport) || 0) && params.add !== '1' && params.import !== '1'}
          />
          <div data-alert-region='crm-sync' className='shrink-0'>
            {/* Just imported: name what landed and hand the user into the
                first-lead loop. One-shot, driven by the import redirect. */}
            <FirstImportCallout
              count={Number(params.firstImport) || 0}
              leadId={Number(params.firstLeadId) || undefined}
              skipped={Number(params.firstImportSkipped) || 0}
            />
            <MetaDisconnectedBanner show={meta.needsReconnect} />
            {/* A lead source that is refusing what arrives — same surface, same
                consequence, same shape as the Meta banner above it. */}
            <LeadIntakeBanner alerts={intake} />
            <OverQuotaBanner count={quota.overQuotaCount} />
            <CrmSyncBanner sources={['leads', 'awareness']} />
          </div>
          <Suspense fallback={null}>
            <ClientsTable leads={true} fillHeight data={clients} user={user} globalLatestUpdatedAt={globalLatestUpdatedAt} formProps={formProps} columnAvailability={columnAvailability} whatsappConnected={wa.connected} />
          </Suspense>
        </>
      ) : (
        <LeadsFirstRun metaConnected={meta.connected && !meta.needsReconnect} whatsappConnected={wa.connected} />
      )}
    </Provider>
  )
}
