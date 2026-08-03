'use client'

import { useRouter } from 'next/navigation'
import type { IntegrationView } from '@/lib/automations/connectors/overview'
import IntegrationConnectionCard from './IntegrationConnectionCard'

/**
 * The Connections page body.
 *
 * It maps over whatever the catalog registered — nothing more. The only
 * decision it makes is refreshing after a change, so a disconnect immediately
 * re-renders health, the events it locks, and the automations it affects.
 */
export default function ConnectionsSettings({ views }: { views: IntegrationView[] }) {
  const router = useRouter()

  if (views.length === 0) {
    return (
      <div className='max-w-3xl rounded-lg border border-gray-200 bg-white p-6'>
        <p className='text-sm text-gray-600'>עדיין אין חיבורים זמינים בחשבון הזה.</p>
      </div>
    )
  }

  return (
    <div className='grid max-w-3xl grid-cols-2 gap-4 mobile:grid-cols-1'>
      {views.map((view) => (
        <IntegrationConnectionCard key={view.integration.key} view={view} onChanged={() => router.refresh()} />
      ))}
    </div>
  )
}
