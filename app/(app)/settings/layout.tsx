import { getUser } from '@/db/auth'
import SettingsLink from '@/lib/navs/SettingsLink'
import { Seperator } from '@/lib/Seperator'
import { isCopilotInspectorEnabled } from '@/lib/ai/flags'
import { isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import SettingsChrome from '@/components/settings/SettingsChrome'

export default async function SettingLayout({ children }) {
  const user = await getUser()
  const inspectorVisible = user.role === 'ADMIN' && isCopilotInspectorEnabled()
  const automationsVisible = user.role === 'ADMIN' && isAutomationsAgencyAllowlisted(user.agencyId)

  return (
    <SettingsChrome
      nav={
        <>
          <SettingsLink href='/settings/self_edit' icon='user' title='פרופיל אישי' />
          {/*
            One entry for every external system. It replaced ערוצי לידים, יומן
            Google and חיבורים, which between them held six systems across four
            nav items — with WhatsApp reachable from one place and its automation
            CTA pointing at another. The lead-source / connected-tool distinction
            is carried by headings inside the page, so navigation stays one line
            no matter how many integrations ship.
          */}
          <SettingsLink href='/settings/integrations' icon='plug' title='אינטגרציות' />

          {user.role == 'ADMIN' && (
            <>
              <Seperator className='my-2' />
              <SettingsLink href='/settings/edit_teams' icon='users' title='צוותים' />
              <SettingsLink href='/settings/edit_users' icon='user-pen' title='משתמשים' />

              <SettingsLink href='/settings/edit_tmplts' icon='list-check' title='תבניות משימות' />
              {/*
                תבניות הצעות מחיר is deliberately NOT a nav item. Quote templates
                are configuration DATA that the quotation automation reads — not a
                destination of their own — so surfacing them beside אוטומציות would
                present two entry points for one job. The route and its components
                stay reachable at /settings/quote-templates because the automation
                depends on the data; only the sidebar entry is withheld.
              */}
              <SettingsLink href='/settings/auto-response' icon='bolt' title='מענה אוטומטי' />
              {automationsVisible && <SettingsLink href='/settings/automations' icon='envelope' title='אוטומציות' />}
              {automationsVisible && (
                <SettingsLink href='/settings/automation-templates' icon='layer-group' title='תבניות אוטומציה' />
              )}
              <Seperator className='my-2' />
              <SettingsLink href='/settings/update_agency' icon='diamond' title='פרטי העסק' />
              <SettingsLink href='/settings/update_user_details' icon='user' title='פרטי נציג' />
              <SettingsLink href='/settings/update_default' icon='folders' title='הגדרות מערכת' />
              <SettingsLink href='/settings/update_security' icon='shield' title='אבטחה' />
              <SettingsLink href='/settings/update_payment' icon='credit-card' title='מנוי ותשלום' />
              {inspectorVisible && <SettingsLink href='/settings/ai-inspector' icon='brain' title='AI Inspector' />}
            </>
          )}
        </>
      }
    >
      {children}
    </SettingsChrome>
  )
}
