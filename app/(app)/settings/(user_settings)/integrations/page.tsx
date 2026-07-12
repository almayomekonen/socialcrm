import type { Metadata } from 'next'
import { requireAgencyUser } from '@/lib/requireUser'
import { INTEGRATIONS } from '@/components/settings/integrations/catalog'
import IntegrationCard from '@/components/settings/integrations/IntegrationCard'

export const metadata: Metadata = { title: 'אינטגרציות' }

export default async function IntegrationsSettingsPage() {
  await requireAgencyUser()

  return (
    <div>
      <h1 className='title'>אינטגרציות</h1>
      <p className='mt-2 mb-6 max-w-2xl text-sm text-gray-600 leading-relaxed'>
        חבר שירותים חיצוניים כדי להעשיר את ה-CRM. החיבור מתבצע פעם אחת וזמין בכל הלידים.
      </p>
      <div className='grid max-w-3xl grid-cols-2 gap-4 mobile:grid-cols-1'>
        {INTEGRATIONS.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} />
        ))}
      </div>
    </div>
  )
}
