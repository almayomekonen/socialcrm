'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import MobileStickyActions from '@/components/mobile/MobileStickyActions'
import LeadContactActions from './LeadContactActions'
import LeadStatusSheet from './LeadStatusSheet'
import LeadFollowUpSheet from './LeadFollowUpSheet'
import LeadOutcomeSheet from './LeadOutcomeSheet'
import LeadOverflowSheet from './LeadOverflowSheet'
import { recordFirstLeadEvent } from '@/actions/analytics/recordFirstLeadEvent'
import { FIRST_LEAD_MOBILE } from '@/lib/activation/firstRunCopy'
import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor } from '@/lib/i18n/config'

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
  firstLead = false,
  whatsappConnected,
}: {
  leadId: number
  phone: string | null
  name: string
  status: string | null
  nextFollowUpAt: string | null
  /** Arrived straight from creating/importing the workspace's first lead. */
  firstLead?: boolean
  /** Workspace WhatsApp connection — decides in-app conversation vs native handoff. */
  whatsappConnected?: boolean
}) {
  const t = useT()
  const [sheet, setSheet] = useState<Sheet>(null)
  // Hebrew: the constant itself (title = the desktop callout's `leadDetail.firstLead.title`).
  const guide =
    t.locale === 'he'
      ? FIRST_LEAD_MOBILE
      : { title: t('leadDetail.firstLead.title'), body: t('leads.mobile.detail.firstLeadBody'), cta: t('leads.mobile.detail.firstLeadCta') }

  /**
   * MOBILE FIRST-LEAD GUIDANCE — the phone half of the loop.
   *
   * The desktop `FirstLeadCallout` is rendered by the desktop lead-summary
   * branch only, and the mobile branch returns before it. A phone user who had
   * just created their first lead therefore got no guidance and emitted no
   * `first_lead_opened` — which is exactly what agencies 119 and 135 did in
   * production. It lives HERE, rather than in a banner higher up the page,
   * because this component already owns the follow-up sheet: the guidance can
   * open the real control instead of pointing at it.
   *
   * Guidance ends the moment a follow-up exists — the same real state the
   * desktop callout uses, never a separate lifecycle.
   */
  const guiding = firstLead && !nextFollowUpAt
  const openedRef = useRef(false)
  useEffect(() => {
    if (!firstLead || openedRef.current) return
    openedRef.current = true
    recordFirstLeadEvent('first_lead_opened', { surface: 'mobile' }).catch(() => {})
  }, [firstLead])

  return (
    <>
      <div className='px-4 pb-3'>
        <LeadOverflowSheet
          leadId={leadId}
          name={name}
          phone={phone}
          onStatus={() => setSheet('status')}
          onFollowUp={() => setSheet('followup')}
          whatsappConnected={whatsappConnected}
        />
        {guiding && (
          <div
            role='status'
            dir={dirFor(t.locale)}
            className='mb-3 rounded-lg border border-gray-200 bg-primary-tint px-3 py-2.5'
          >
            <p className='text-[13px] font-bold text-ink'>{guide.title}</p>
            <p className='mt-0.5 text-[13px] leading-relaxed text-gray-600'>{guide.body}</p>
            <button
              type='button'
              onClick={() => setSheet('followup')}
              className='press mt-2.5 flex min-h-11 w-full items-center justify-center rounded-md bg-solid text-[14px] font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
            >
              {guide.cta}
            </button>
          </div>
        )}

        <div className='grid grid-cols-3 gap-2'>
          <ActionBtn label={t('leads.table.header.status')} icon='tag' onClick={() => setSheet('status')} />
          <ActionBtn label={t('leads.mobile.detail.followUp')} icon='calendar' onClick={() => setSheet('followup')} />
          <ActionBtn label={t('leads.mobile.detail.outcome')} icon='comment-check' onClick={() => setSheet('outcome')} />
        </div>
      </div>

      {phone ? (
        <MobileStickyActions aboveTabBar>
          <LeadContactActions
            leadId={leadId}
            phone={phone}
            name={name}
            size='bar'
            className='w-full'
            whatsappConnected={whatsappConnected}
          />
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
