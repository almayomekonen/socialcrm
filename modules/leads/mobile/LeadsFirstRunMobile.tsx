'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { recordFirstLeadEvent } from '@/actions/analytics/recordFirstLeadEvent'
import Icon from '@/lib/Icon'
import { MetaLeadAdsBadge, WhatsappBadge } from '@/components/ui/MetaLeadAdsBadge'
import MobileListRow, { MobileList } from '@/components/mobile/MobileListRow'
import LeadFormMobile from './LeadFormMobile'
import LeadImportMobile from './LeadImportMobile'

/**
 * The mobile first-run surface — shared by empty Leads and empty Today.
 *
 * Desktop `LeadsFirstRun` stays the four-card grid. This screen is a phone
 * onboarding surface: add or import now, then connect the channels that feed
 * new leads. Nothing here tells the user to continue on a computer.
 */
export default function LeadsFirstRunMobile({
  metaConnected = false,
  whatsappConnected = false,
}: {
  metaConnected?: boolean
  whatsappConnected?: boolean
}) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const heading = metaConnected ? 'אין עדיין לידים' : 'בואו נתחיל'
  const body = metaConnected
    ? 'חשבון ה‑Meta שלך מחובר. הליד הראשון יופיע כאן אוטומטית, ואפשר גם להוסיף או לייבא עכשיו.'
    : 'הוסיפו את הליד הראשון שלכם או חברו את הערוצים שמהם מגיעים הלידים.'

  return (
    <>
      <div dir='rtl' className='flex flex-col px-4 py-6'>
        <header className='mb-5'>
          <h1 className='text-xl font-bold leading-tight text-ink'>{heading}</h1>
          <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>{body}</p>
        </header>

        <div className='flex flex-col gap-2'>
          <button
            type='button'
            className='press flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
            onClick={() => {
              setImportOpen(false)
              setFormOpen(true)
            }}
          >
            <Icon name='plus' type='sol' className='size-4 bg-white' />
            הוסף ליד
          </button>
          <button
            type='button'
            className='press flex min-h-12 w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
            onClick={() => {
              setFormOpen(false)
              setImportOpen(true)
            }}
          >
            <Icon name='file-excel' type='sol' className='size-4 bg-ink' />
            ייבוא לידים
          </button>
        </div>

        <h2 className='mb-2 mt-8 text-sm font-semibold text-gray-500'>חיבור ערוצים</h2>
        <div className='overflow-hidden rounded-xl border border-gray-200 bg-white'>
          <MobileList>
            <MobileListRow
              href={'/settings/integrations?section=whatsapp' as Route}
              className='press'
              title='וואטסאפ'
              subtitle={whatsappConnected ? 'מחובר' : 'לא מחובר'}
              leading={<WhatsappBadge size='sm' />}
            />
            <MobileListRow
              href={'/settings/integrations?section=facebook' as Route}
              className='press'
              title='פייסבוק ואינסטגרם'
              subtitle={metaConnected ? 'מחובר' : 'לא מחובר'}
              leading={<MetaLeadAdsBadge size='sm' />}
            />
          </MobileList>
        </div>
      </div>

      <LeadFormMobile
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={(leadId) => {
          recordFirstLeadEvent('first_manual_lead_created').catch(() => {})
          router.push(`/clients/${leadId}/summary?firstLead=1`)
        }}
      />
      <LeadImportMobile open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  )
}
