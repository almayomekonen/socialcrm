'use client'

import type { BriefingSection } from '@/lib/copilot/general/types'
import { SECTION_EMPTY, SECTION_TITLE } from './sectionMeta'
import { promisedWaitingSentence } from '@/lib/copilot/general/promisedWaiting'
import LeadRows from './LeadRows'
import DeepLink from './DeepLink'

// A briefing card is a glanceable PREVIEW, not the full list. Real data showed a
// section can hold 78 leads; rendering all 50 sampled rows floods the panel.
// Show a few, lean on the headline count + "ועוד N" for the rest.
const BRIEFING_PREVIEW = 4

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
    const shown = section.sample.slice(0, BRIEFING_PREVIEW)
    return (
      <ul className='space-y-0.5'>
        {shown.map((m) => (
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
        {section.total > shown.length && (
          <li className='text-[11px] text-gray-400'>ועוד {section.total - shown.length}</li>
        )}
      </ul>
    )
  }
  // Lead-list sections (overdue / due-today / not-contacted / new-this-week).
  return (
    <LeadRows
      total={section.total}
      sample={section.sample.slice(0, BRIEFING_PREVIEW)}
      emptyText={SECTION_EMPTY[section.id]}
      source='briefing-section'
    />
  )
}

function SectionCard({ section }: { section: BriefingSection }) {
  // The unsolicited save leads with a full operator sentence, not a label+count.
  if (section.id === 'followups.promisedWaiting') {
    return (
      <div className='rounded-md border border-gray-200 p-2.5'>
        <p className='mb-1.5 text-[13px] font-medium text-gray-800'>{promisedWaitingSentence(section.total)}</p>
        <SectionBody section={section} />
      </div>
    )
  }
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
