'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ModalPop from '@/lib/modals/ModalPop'
import ClientFormPop from './ClientFormPop'
import UploadClientData from '@/components/settings/UploadClientData'
import { MetaLeadAdsBadge } from '@/components/ui/MetaLeadAdsBadge'
import OnboardingActionCard from './OnboardingActionCard'
import { recordFirstLeadEvent } from '@/actions/analytics/recordFirstLeadEvent'
import { FIRST_RUN_COPY as C } from '@/lib/activation/firstRunCopy'
import { useFirstRunAnalytics } from '@/hooks/useFirstRunAnalytics'

/**
 * The desktop first-run surface.
 *
 * SAME MESSAGE AS MOBILE, OWN LAYOUT. The copy comes from
 * `lib/activation/firstRunCopy.ts`, which the phone's first-run screen reads
 * too; the presentation stays a tile grid, because a desktop has the room and
 * forcing it into the phone's list shape would be change for its own sake.
 * (This file deliberately references no mobile component — the a11y suite
 * asserts that separation, and the shared constants file is the only seam.)
 *
 * WHAT CHANGED AND WHY. This screen previously showed four cards of equal
 * weight under a headline describing a data-entry task, with a subtitle that
 * ended by selling the Pro plan. Three specific defects, all fixed here:
 *
 *   · No outcome statement. The reader was asked to work before being told what
 *     the work produces — the same failure the mobile screen has, and the reason
 *     four consecutive mobile signups left within seconds.
 *   · No hierarchy. `OnboardingActionCard` has shipped a `recommended` prop with
 *     a real primary treatment since it was written, and this file never passed
 *     it; a text badge carried the whole burden of saying "start here".
 *   · Two uses of "לקוחות" ("נהל שיחות עם לקוחות", "העבר את כל הלקוחות"), which
 *     `ux-guidelines.md` §6 forbids outright — leads are not customers.
 *
 * The four actions are now grouped into the two paths the user actually has,
 * each with a heading and a reason: connect a source (recommended, because it
 * is what keeps working tomorrow), or bring leads you already have (immediate
 * value, and `product.md` §7's own first success moment). Neither is a fallback.
 */
export default function LeadsFirstRun({
  metaConnected = false,
  whatsappConnected = false,
}: {
  metaConnected?: boolean
  whatsappConnected?: boolean
}) {
  const router = useRouter()
  const [openForm, setOpenForm] = useState(false)
  const [openUpload, setOpenUpload] = useState(false)

  const { markConnectIntent } = useFirstRunAnalytics({
    surface: 'desktop',
    metaConnected,
    whatsappConnected,
  })

  /**
   * After a first import, hand the user into the first-lead loop instead of
   * refreshing a table underneath them. `firstLeadId` opens a REAL lead with
   * the existing `?firstLead=1` signal, so import and manual create converge on
   * one flow — see components/clients/FirstImportCallout.tsx.
   */
  const onImported = (inserted: number, firstId?: number) => {
    const qs = new URLSearchParams({ firstImport: String(inserted) })
    if (firstId) qs.set('firstLeadId', String(firstId))
    setOpenUpload(false)
    router.push(`/leads?${qs.toString()}`)
  }

  const bothConnected = metaConnected && whatsappConnected

  return (
    <div
      dir='rtl'
      data-leads-empty=''
      className='flex min-h-full w-full flex-col items-center justify-center px-6 py-16'
    >
      <div className='w-full max-w-2xl'>
        <header className='mb-9 text-center'>
          <h1 className='text-4xl font-bold tracking-tight text-ink'>
            {metaConnected ? C.connected.headline : C.headline}
          </h1>
          <p className='mx-auto mt-3 max-w-xl text-lg leading-relaxed text-gray-600'>
            {metaConnected ? C.connected.subhead : C.subhead}
          </p>
        </header>

        {/* PATH 1 — the leads the business already has.
            PROMOTED TO FIRST, and marked `recommended`.

            This is the only path that puts real data on the screen today, and
            `product.md` §7 names it the product's first success moment. It had
            been the fourth of four tiles, described by its file format. In
            production `leads_imported` had two rows, ever, from one agency. */}
        <section className='mb-8'>
          <h2 className='text-base font-semibold text-ink'>{C.own.heading}</h2>
          <p className='mb-3 mt-0.5 text-sm text-gray-500'>{C.own.rationale}</p>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <OnboardingActionCard
              onClick={() => setOpenUpload(true)}
              icon='file-excel'
              tileClass='bg-[#217346]'
              title={C.own.import.title}
              description={C.own.import.description}
              badge={C.own.recommendedBadge}
              badgeClass='bg-info-bg text-info-text'
              recommended
            />
            <OnboardingActionCard
              onClick={() => setOpenForm(true)}
              icon='plus'
              tileClass='bg-ink'
              title={C.own.add.title}
              description={C.own.add.description}
              data-add-lead=''
            />
          </div>
        </section>

        {/* PATH 2 — connect a source. Still a real path, and still the thing
            that keeps working tomorrow — but it delivers zero leads today, so it
            no longer leads. The `recommended` treatment moved to import above;
            this block keeps its heading and reason and is never demoted. */}
        {!bothConnected && (
          <section className='mb-8'>
            <h2 className='text-base font-semibold text-ink'>{C.connect.heading}</h2>
            <p className='mb-3 mt-0.5 text-sm text-gray-500'>{C.connect.rationale}</p>
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              {!whatsappConnected && (
                <OnboardingActionCard
                  href={C.connect.whatsapp.href}
                  onClick={markConnectIntent}
                  icon='whatsapp'
                  tileClass='bg-[#25D366]'
                  title={C.connect.whatsapp.title}
                  description={C.connect.whatsapp.description}
                />
              )}
              {!metaConnected && (
                <OnboardingActionCard
                  href={C.connect.meta.href}
                  onClick={markConnectIntent}
                  tile={<MetaLeadAdsBadge size='lg' />}
                  title={C.connect.meta.title}
                  description={C.connect.meta.description}
                />
              )}
            </div>
          </section>
        )}

      </div>

      <ModalPop open={openForm} label='פרטי ליד' pos='middle' onClose={() => setOpenForm(false)}>
        <ClientFormPop
          client={null}
          onClose={() => setOpenForm(false)}
          onCreated={(leadId) => {
            // First manual lead: LeadsFirstRun renders only when the workspace
            // has no leads, so this create is the workspace's first lead. Route
            // into the real lead (canonical summary route) with the one-shot
            // ?firstLead=1 signal instead of refreshing the one-row table.
            recordFirstLeadEvent('first_manual_lead_created').catch(() => {})
            router.push(`/clients/${leadId}/summary?firstLead=1`)
          }}
        />
      </ModalPop>

      <ModalPop open={openUpload} label='העלאת לידים' pos='middle' onClose={() => setOpenUpload(false)}>
        <UploadClientData onImported={onImported} />
      </ModalPop>
    </div>
  )
}
