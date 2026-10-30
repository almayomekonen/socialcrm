'use client'

import { useRouter } from 'next/navigation'
import type { IntegrationView } from '@/lib/automations/connectors/overview'
import IntegrationConnectionCard from './IntegrationConnectionCard'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'

/**
 * The Connections page body.
 *
 * It maps over whatever the catalog registered — nothing more. The only
 * decision it makes is refreshing after a change, so a disconnect immediately
 * re-renders health, the events it locks, and the automations it affects.
 */
export default function ConnectionsSettings({ views }: { views: IntegrationView[] }) {
  const router = useRouter()
  const t = useT()
  const region = useRegionAttrs()

  if (views.length === 0) {
    return (
      <div className='max-w-3xl rounded-lg border border-gray-200 bg-white p-6' {...region}>
        <p className='text-sm text-gray-600'>{t('admin.connections.none')}</p>
      </div>
    )
  }

  return (
    // Single column: this renders inside a section that already sets the width.
    // A two-column grid here squeezed a lone card into half a container.
    <div className='grid gap-4' {...region}>
      {views.map((view) => (
        <IntegrationConnectionCard key={view.integration.key} view={view} onChanged={() => router.refresh()} />
      ))}
    </div>
  )
}
