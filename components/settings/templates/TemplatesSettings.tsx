'use client'

import { useRouter } from 'next/navigation'
import type { TemplateView } from '@/lib/automations/templates/overview'
import TemplateCard from './TemplateCard'
import { CATEGORY, CATEGORY_ORDER } from './copy'

/**
 * The marketplace body: templates grouped by the category each one declares.
 *
 * No ordering logic and no curation — the page shows what is registered, in
 * the order the catalog registered it.
 */
export default function TemplatesSettings({ views }: { views: TemplateView[] }) {
  const router = useRouter()

  if (views.length === 0) {
    return (
      <div className='max-w-3xl rounded-lg border border-gray-200 bg-white p-6'>
        <p className='text-sm text-gray-600'>עדיין אין תבניות זמינות.</p>
      </div>
    )
  }

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    items: views.filter((v) => v.template.category === category),
  })).filter((g) => g.items.length > 0)

  return (
    <div className='grid gap-8 max-w-3xl'>
      {groups.map((group) => (
        <section key={group.category} className='grid gap-4'>
          <h2 className='text-base font-semibold text-gray-800'>{CATEGORY[group.category]}</h2>
          <div className='grid grid-cols-2 gap-4 mobile:grid-cols-1'>
            {group.items.map((view) => (
              <TemplateCard key={view.template.key} view={view} onChanged={() => router.refresh()} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
