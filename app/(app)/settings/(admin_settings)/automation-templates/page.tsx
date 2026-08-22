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
   * TIER 2. The page stays readable: an expired customer can still see what
   * they built and what the product does for them. Only the actions that spend
   * money stay gated, each at its own control, so this surface teaches value
   * instead of turning into a wall.
   */
  const proLocked = !(await getAgencyProductAccess(user.agencyId)).hasAccess

  const views = await templateOverview(user.agencyId)

  return (
    <div>
      {proLocked && (
        <div className='mb-6 max-w-2xl'>
          <SubscriptionExpiredState mode='inline' source='automation_templates_settings' feature='חידוש המנוי מחזיר את התקנת האוטומציות' />
        </div>
      )}
      <h1 className='title'>תבניות אוטומציה</h1>
      <p className='mt-2 mb-8 max-w-2xl text-sm text-gray-600 leading-relaxed'>
        אוטומציות מוכנות לשימוש. ההתקנה יוצרת אותן כטיוטות אצלכם — משם הן שלכם לחלוטין, לעריכה ולהפעלה.
      </p>
      <TemplatesSettings views={views} />
    </div>
  )
}
