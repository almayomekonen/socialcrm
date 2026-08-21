import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'
import { isAutomationsAgencyAllowlisted } from '@/lib/automations/flags'
import { templateOverview } from '@/lib/automations/templates/overview'
import TemplatesSettings from '@/components/settings/templates/TemplatesSettings'

export const metadata: Metadata = { title: 'תבניות אוטומציה' }

/**
 * Settings → תבניות אוטומציה.
 *
 * Every registered template renders here with no page edit. Installing creates
 * ordinary automations through the same store the Builder uses; from that
 * moment the customer owns them and this page has no further authority.
 */
export default async function AutomationTemplatesPage() {
  const user = await requireAgencyUser()
  if (!isAutomationsAgencyAllowlisted(user.agencyId)) {
    return <div className='max-w-3xl'>הדף אינו זמין בחשבון הזה.</div>
  }
  /*
   * Pure-configuration page: every control on it calls a
   * requireProductAccess-guarded action. Left open to a lapsed
   * subscription, each button was a doomed request that surfaced as a
   * generic toast or an unhandled Server Action rejection. Same page-level
   * lock the notifications page already uses; no customer DATA is hidden by
   * it, only settings the customer cannot change right now.
   *
   * Runs AFTER the existing permission/availability check: who you are is a
   * stronger statement than what your plan currently covers, and telling
   * someone who could never use this page that their subscription ended
   * would simply be wrong.
   */
  if (!(await getAgencyProductAccess(user.agencyId)).hasAccess) {
    return <SubscriptionExpiredState mode='page' source='automation_templates_settings' feature='האוטומציות מושהות.' />
  }

  const views = await templateOverview(user.agencyId)

  return (
    <div>
      <h1 className='title'>תבניות אוטומציה</h1>
      <p className='mt-2 mb-8 max-w-2xl text-sm text-gray-600 leading-relaxed'>
        אוטומציות מוכנות לשימוש. ההתקנה יוצרת אותן כטיוטות אצלכם — משם הן שלכם לחלוטין, לעריכה ולהפעלה.
      </p>
      <TemplatesSettings views={views} />
    </div>
  )
}
