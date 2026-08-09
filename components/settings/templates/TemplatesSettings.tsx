'use client'

import { useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
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
      <div className='max-w-3xl rounded-lg border border-gray-200 bg-white px-6 py-12 text-center'>
        <Icon name='layer-group' className='mx-auto size-8 bg-gray-300' />
        <p className='mt-3 text-base font-medium text-gray-700'>הגלריה עדיין ריקה</p>
        <p className='mx-auto mt-1 max-w-sm text-sm leading-relaxed text-gray-500'>
          כשיתווספו תבניות מוכנות הן יופיעו כאן, מוכנות להתקנה בלחיצה.
        </p>
      </div>
    )
  }

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    items: views.filter((v) => v.template.category === category),
  })).filter((g) => g.items.length > 0)

  return (
    <div className='grid max-w-252.5 gap-10'>
      {groups.map((group) => (
        <section key={group.category}>
          {/*
            The heading is set as a quiet label with a rule running off to the
            side, so it separates the gallery into sections without competing
            with the cards — the cards are what the eye should land on.
          */}
          <div className='flex items-center gap-3 pb-4.5'>
            <h2 className='text-[12.5px] font-semibold tracking-[0.14em] text-[#aab3c0]'>
              {CATEGORY[group.category]}
            </h2>
            <span className='text-[12.5px] text-[#c2c9d4]'>{group.items.length}</span>
            <span aria-hidden='true' className='h-px flex-1 bg-[#eef0f4]' />
          </div>
          <div className='grid grid-cols-2 gap-4.5 mobile:grid-cols-1'>
            {group.items.map((view) => (
              <TemplateCard key={view.template.key} view={view} onChanged={() => router.refresh()} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
