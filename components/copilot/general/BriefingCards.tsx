'use client'

import type { BriefingSection } from '@/lib/copilot/general/types'
import { SECTION_EMPTY, SECTION_TITLE } from './sectionMeta'
import LeadRows from './LeadRows'
import DeepLink from './DeepLink'

function SectionBody({ section }: { section: BriefingSection }) {
  if (section.id === 'inbox.unread') {
    if (section.unread === 0) return <p className='text-xs text-gray-400'>{SECTION_EMPTY['inbox.unread']}</p>
    return (
      <DeepLink href='/inbox' source='briefing-section' className='text-[13px] text-gray-700 hover:text-gray-900'>
        {section.unread} הודעות ב-{section.conversations} שיחות
      </DeepLink>
    )
  }
  if (section.id === 'meetings.today') {
    if (section.total === 0) return <p className='text-xs text-gray-400'>{SECTION_EMPTY['meetings.today']}</p>
    return (
      <ul className='space-y-0.5'>
        {section.sample.map((m) => (
          <li key={m.id}>
            <DeepLink
              href='/calendar'
              source='briefing-section'
              className='block truncate text-[13px] text-gray-700 hover:text-gray-900'
            >
              {m.title}
              {m.leadName ? ` · ${m.leadName}` : ''}
            </DeepLink>
          </li>
        ))}
      </ul>
    )
  }
  // Lead-list sections (overdue / due-today / not-contacted / new-this-week).
  return (
    <LeadRows total={section.total} sample={section.sample} emptyText={SECTION_EMPTY[section.id]} source='briefing-section' />
  )
}

function SectionCard({ section }: { section: BriefingSection }) {
  const headline = section.id === 'inbox.unread' ? section.unread : section.total
  return (
    <div className='rounded-md border border-gray-200 p-2.5'>
      <div className='mb-1.5 flex items-center justify-between'>
        <span className='text-[12.5px] font-medium text-gray-700'>{SECTION_TITLE[section.id]}</span>
        {headline > 0 && <span className='text-[12px] tabular-nums text-gray-500'>{headline}</span>}
      </div>
      <SectionBody section={section} />
    </div>
  )
}

/** Deterministic briefing: greeting line + one card per section. */
export default function BriefingCards({ greeting, sections }: { greeting: string; sections: BriefingSection[] }) {
  return (
    <div className='space-y-2'>
      {greeting && <p className='px-0.5 text-[13px] text-gray-600'>{greeting}</p>}
      {sections.map((s) => (
        <SectionCard key={s.id} section={s} />
      ))}
    </div>
  )
}
