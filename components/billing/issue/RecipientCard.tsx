'use client'

import { Btn } from '@/lib/btns/Btn'
import LeadPicker from '@/components/billing/lead-picker/LeadPicker'
import type { RecentLead } from '@/components/billing/lead-picker/types'
import type { BillBillingProfileRow } from '@/db/billing/profiles'
import { cardCls, sectionHeaderCls, eyebrowCls } from './styles'

/**
 * Recipient card — picker + profile strip.
 *
 * Top: customer picker (combobox) + "+ יצירת לקוח/ה" trigger button.
 * Bottom: read-only profile strip showing the billing details that
 * will appear on the invoice.
 *
 * Pure container — receives the picker handlers and the profile data;
 * decides nothing about lead navigation or modal opening.
 */
export default function RecipientCard({
  leadId,
  leadName,
  profile,
  recentLeads,
  onPickLead,
  onCreateNewLead,
}: {
  leadId: number
  leadName: string
  profile: BillBillingProfileRow | null
  recentLeads: ReadonlyArray<RecentLead>
  onPickLead: (leadId: number) => void
  onCreateNewLead: () => void
}) {
  return (
    <section className={cardCls}>
      <div className={sectionHeaderCls}>
        <h2 className={eyebrowCls}>לכבוד</h2>
      </div>
      <div className='px-6 py-6 grid gap-5'>
        <div className='flex gap-2 items-stretch max-w-2xl'>
          <div className='flex-1 min-w-0'>
            <LeadPicker
              currentLeadId={leadId}
              currentLeadName={leadName}
              recentLeads={recentLeads}
              onPick={onPickLead}
              onCreateNew={onCreateNewLead}
            />
          </div>
          <Btn icon='plus' lbl='יצירת לקוח/ה' onClick={onCreateNewLead} />
        </div>
        {profile ? <ProfileStrip profile={profile} /> : <ProfileFallback leadName={leadName} />}
      </div>
    </section>
  )
}

function ProfileStrip({ profile }: { profile: BillBillingProfileRow }) {
  const address = [profile.address, profile.city, profile.zip].filter(Boolean).join(', ')
  return (
    <>
      <p className='text-lg font-semibold text-gray-900'>{profile.legalName?.trim() || '—'}</p>
      <div className='mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-base text-gray-600'>
        {profile.taxId?.trim() && <span>ע.מ / ח.פ: {profile.taxId}</span>}
        {address && (
          <>
            <span className='text-gray-300'>·</span>
            <span>{address}</span>
          </>
        )}
        {profile.email?.trim() && (
          <>
            <span className='text-gray-300'>·</span>
            <span dir='ltr' className='tabular-nums'>
              {profile.email}
            </span>
          </>
        )}
        {profile.phone?.trim() && (
          <>
            <span className='text-gray-300'>·</span>
            <span dir='ltr' className='tabular-nums'>
              {profile.phone}
            </span>
          </>
        )}
      </div>
    </>
  )
}

function ProfileFallback({ leadName }: { leadName: string }) {
  return (
    <p className='text-base text-gray-600'>
      פרטי החיוב יוגדרו בעת השמירה, על בסיס שם הליד:{' '}
      <span className='font-medium text-gray-800'>{leadName || 'ללא שם'}</span>
    </p>
  )
}
