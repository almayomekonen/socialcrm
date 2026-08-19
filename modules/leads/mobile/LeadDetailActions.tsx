'use client'

import { useState } from 'react'
import Icon from '@/lib/Icon'
import MobileStickyActions from '@/components/mobile/MobileStickyActions'
import LeadContactActions from './LeadContactActions'
import LeadStatusSheet from './LeadStatusSheet'
import LeadFollowUpSheet from './LeadFollowUpSheet'
import LeadOutcomeSheet from './LeadOutcomeSheet'
import LeadOverflowSheet from './LeadOverflowSheet'

type Sheet = 'status' | 'followup' | 'outcome' | null

/**
 * The three lead-work actions + the sticky Call/WhatsApp bar.
 *
 * Sheets, not floating menus: a phone cannot aim at a 130px desktop popover.
 * Each sheet calls the EXISTING server action — status → `updateLead`,
 * follow-up → `setLeadFollowUp`, outcome → `logLeadOutcome`.
 */
export default function LeadDetailActions({
  leadId,
  phone,
  name,
  status,
  nextFollowUpAt,
}: {
  leadId: number
  phone: string | null
  name: string
  status: string | null
  nextFollowUpAt: string | null
}) {
  const [sheet, setSheet] = useState<Sheet>(null)

  return (
    <>
      <div className='px-4 pb-3'>
        <LeadOverflowSheet
          leadId={leadId}
          name={name}
          phone={phone}
          onStatus={() => setSheet('status')}
          onFollowUp={() => setSheet('followup')}
        />
        <div className='grid grid-cols-3 gap-2'>
          <ActionBtn label='סטטוס' icon='tag' onClick={() => setSheet('status')} />
          <ActionBtn label='מעקב' icon='calendar' onClick={() => setSheet('followup')} />
          <ActionBtn label='תוצאה' icon='comment-check' onClick={() => setSheet('outcome')} />
        </div>
      </div>

      {phone ? (
        <MobileStickyActions aboveTabBar>
          <LeadContactActions leadId={leadId} phone={phone} name={name} size='bar' className='w-full' />
        </MobileStickyActions>
      ) : null}

      <LeadStatusSheet open={sheet === 'status'} onClose={() => setSheet(null)} leadId={leadId} current={status} />
      <LeadFollowUpSheet
        open={sheet === 'followup'}
        onClose={() => setSheet(null)}
        leadId={leadId}
        current={nextFollowUpAt}
      />
      <LeadOutcomeSheet open={sheet === 'outcome'} onClose={() => setSheet(null)} leadId={leadId} />
    </>
  )
}

function ActionBtn({ label, icon, onClick }: { label: string; icon: 'tag' | 'calendar' | 'comment-check'; onClick: () => void }) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white text-[13px] font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
    >
      <Icon name={icon} type='sol' className='size-3.5 bg-gray-600' />
      {label}
    </button>
  )
}
