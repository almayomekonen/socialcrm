import { getUser } from '@/db/auth'
import SettingsLink from '@/lib/navs/SettingsLink'
import { Seperator } from '@/lib/Seperator'
import { isCopilotInspectorEnabled } from '@/lib/ai/flags'
import { isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import SettingsChrome from '@/components/settings/SettingsChrome'
import { isMobileRequest } from '@/lib/device'
import { canEnterMobileWorkspace } from '@/lib/flags/mobileFlags'
import { canUseQuestionnaireBuilder } from '@/lib/flags/questionnaireBuilderFlags'
import { canUseOwnerWhatsappReminders } from '@/lib/flags/ownerWhatsappReminderFlags'

export default async function SettingLayout({ children }) {
  const user = await getUser()
  const inspectorVisible = user.role === 'ADMIN' && isCopilotInspectorEnabled()

  /**
   * The mobile workspace navigates to settings destinations DIRECTLY from the
   * "עוד" hub, so the nav column is redundant there — and worse, on a phone it
   * stacks above the content and buries the destination. Resolved on the server
   * and passed as absence, never CSS-hidden.
   */
  const mobileWorkspace = (await isMobileRequest()) && canEnterMobileWorkspace(user.agencyId)
  const automationsVisible = user.role === 'ADMIN' && isAutomationsAgencyAllowlisted(user.agencyId)
  // Absent, not disabled, outside the Builder rollout: the route 404s there too.
  const questionnaireBuilderVisible = user.role === 'ADMIN' && canUseQuestionnaireBuilder(user.agencyId)
  // Every role: a reminder goes to the lead's handler, whoever that is. Absent outside the rollout.
  const whatsappRemindersVisible = canUseOwnerWhatsappReminders(user.agencyId)

  return (
    <SettingsChrome
      nav={
        mobileWorkspace ? null : (
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
          {whatsappRemindersVisible && (
            <SettingsLink href='/settings/whatsapp_reminders' icon='bell' title='תזכורות בוואטסאפ' />
          )}

          {/*
            Reachable by EVERY role, deliberately outside the ADMIN block below:
            a נציג who cannot log in, or whose WhatsApp is down, is exactly the
            person who needs to reach us, and routing them through their manager
            adds a hop at the worst possible moment. The destination lives
            outside the (app) product gate so it also works when the workspace
            itself is blocked.
          */}
          <SettingsLink href='/support' icon='life-ring' title='תמיכה' />

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
              {questionnaireBuilderVisible && (
                <SettingsLink href='/settings/questionnaire' icon='clipboard-list' title='שאלון וואטסאפ' />
              )}
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
        )
      }
    >
      {children}
    </SettingsChrome>
  )
}
