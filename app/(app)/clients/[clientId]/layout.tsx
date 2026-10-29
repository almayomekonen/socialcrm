import { Suspense } from 'react'
import { getUser } from '@/db/auth'
import ClientHeader from '@/components/clientPage/ClientHeader'
import ClientNav from '@/components/clientPage/ClientNav'
import { getFullLead, getFamMembers } from '@/db/clients'
import { getUserNameById, getUsers } from '@/db/usersNTeams'
import { getPerms } from '@/db/filter'
import CopilotLeadContext from '@/components/copilot/CopilotLeadContext'
import { Metadata } from 'next'
import { isMobileRequest } from '@/lib/device'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'
import { getServerT, getUiLocaleState } from '@/lib/i18n/server'
import { regionAttrs } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/** Tab title in the interface language — Hebrew ('נתוני ליד') outside the UI_LOCALE_* rollout. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT(await getUser())
  return { title: t('leadDetail.page.title'), description: t('leadDetail.page.description') }
}

export default async function layout({ children, params }) {
  const { clientId } = await params
  const user = await getUser()

  /**
   * MOBILE LEAD DETAIL (Phase A). The desktop ClientHeader + four-tab ClientNav
   * + Copilot context are never rendered on a phone. The summary page supplies
   * its own presentation; other client sub-routes still render their children
   * inside the mobile shell (back arrow, no second nav).
   */
  if ((await isMobileRequest()) && canEnterMobileWorkspace(user?.agencyId)) {
    return children
  }

  const client = await getFullLead({
    id: clientId,
    select: ['name', 'rank', 'birthDate', 'gender', 'familyStatus', 'email', 'phone', 'secPhone', 'handlerId'],
  })

  if (!client?.name) {
    const { locale } = await getUiLocaleState(user)
    return <div {...regionAttrs(locale)}>{translatorFor(locale)('leadDetail.page.notFound')}</div>
  }

  const [handlerName, family, perms, allUsers] = await Promise.all([
    getUserNameById(client?.handlerId),
    getFamMembers(clientId).then((r) => r.famMembers),
    getPerms(user),
    getUsers({ withOfficeUsers: true, withExtUsers: true }),
  ])

  const formProps = { user, officeGotPerm: perms.gotPermUsers, allUsers }

  // The header and the tab nav declare the interface language themselves; the
  // tab CONTENT (children) keeps inheriting <main>'s language until each tab is
  // translated, so this wrapper declares nothing.
  return (
    <div className='mb-8 '>
      <ClientHeader
        client={client}
        user={user}
        handlerName={handlerName}
        family={family}
        clientId={clientId}
        formProps={formProps}
      />
      <ClientNav id={clientId} />
      {children}
      <Suspense fallback={null}>
        <CopilotLeadContext leadId={clientId} />
      </Suspense>
    </div>
  )
}
