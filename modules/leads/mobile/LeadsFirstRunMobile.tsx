'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { recordFirstLeadEvent } from '@/actions/analytics/recordFirstLeadEvent'
import Icon from '@/lib/Icon'
import { MetaLeadAdsBadge, WhatsappBadge } from '@/components/ui/MetaLeadAdsBadge'
import MobileListRow, { MobileList } from '@/components/mobile/MobileListRow'
import { FIRST_RUN_COPY as C } from '@/lib/activation/firstRunCopy'
import { useFirstRunAnalytics } from '@/hooks/useFirstRunAnalytics'
import LeadFormMobile from './LeadFormMobile'
import LeadImportMobile from './LeadImportMobile'

/**
 * The mobile first-run surface — shared by empty Leads and empty Today.
 *
 * TWO NAMED PATHS, not four undifferentiated choices.
 *
 *   1. Connect the source your leads already arrive through — the product
 *      promise, recommended, and the only thing that keeps working tomorrow.
 *   2. Already have leads? Add or import them now — immediate real value, and
 *      `product.md` §7's own first success moment.
 *
 * Each block gets a heading and one line saying why it is worth doing. The
 * second is NOT an escape hatch: on a phone inside Facebook's in-app browser —
 * where a measurable share of this product's signups arrive — OAuth popups are
 * unreliable, and typing one lead is the path most likely to complete. Making
 * it look like a consolation prize would cost the activation it exists to win.
 *
 * Emphasis is carried by the connect block's tint (the same treatment
 * `OnboardingActionCard` already uses for `recommended` on desktop), never by
 * making the second block look disabled. One recommendation, zero demotion.
 *
 * Copy lives in `lib/activation/firstRunCopy.ts` — shared with desktop so the
 * two screens can never again describe the same product differently.
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

  const { markConnectIntent } = useFirstRunAnalytics({
    surface: 'mobile',
    metaConnected,
    whatsappConnected,
  })

  const bothConnected = metaConnected && whatsappConnected
  const heading = metaConnected ? C.connected.headline : C.headline
  const body = metaConnected ? C.connected.subhead : C.subhead

  return (
    <>
      <div dir='rtl' className='flex flex-col px-4 py-6'>
        <header className='mb-6'>
          <h1 className='text-xl font-bold leading-tight text-ink'>{heading}</h1>
          <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>{body}</p>
        </header>

        {/*
          PATH 1 — connect a source. Hidden only when there is nothing left to
          offer, which is the one case where showing it would be noise.
          Tinted to mark it as the recommendation; `bg-primary-tint/50` +
          `border-primary/40` are the exact tokens OnboardingActionCard uses for
          `recommended`, so the two surfaces read as one product.
        */}
        {/*
          PATH 1 — the leads the business already has. PROMOTED TO FIRST and
          tinted as the recommendation.

          On a phone this is not the lesser path, it is the likelier one: inside
          Facebook's in-app browser an OAuth popup is unreliable and there may be
          no spreadsheet on the device, so "paste your numbers" is the import
          most likely to complete. `product.md` §7 also names it the product's
          first success moment.
        */}
        <section className='mb-7'>
          <h2 className='text-sm font-semibold text-ink'>{C.own.heading}</h2>
          <p className='mb-2.5 mt-0.5 text-[13px] leading-relaxed text-gray-500'>{C.own.rationale}</p>
          <div className='overflow-hidden rounded-xl border border-primary/40 bg-primary-tint/50'>
            <MobileList>
              <MobileListRow
                onClick={() => {
                  setFormOpen(false)
                  setImportOpen(true)
                }}
                className='press'
                title={C.own.import.title}
                subtitle={C.own.import.description}
                leading={
                  <span className='flex size-9 items-center justify-center rounded-lg bg-[#217346]'>
                    <Icon name='file-excel' type='sol' className='size-4 bg-white' />
                  </span>
                }
                badges={
                  <span className='rounded-full bg-info-bg px-2 py-0.5 text-[11px] font-medium text-info-text'>
                    {C.own.recommendedBadge}
                  </span>
                }
              />
              <MobileListRow
                onClick={() => {
                  setImportOpen(false)
                  setFormOpen(true)
                }}
                className='press'
                title={C.own.add.title}
                subtitle={C.own.add.description}
                leading={
                  <span className='flex size-9 items-center justify-center rounded-lg bg-ink'>
                    <Icon name='plus' type='sol' className='size-4 bg-white' />
                  </span>
                }
              />
            </MobileList>
          </div>
        </section>

        {!bothConnected && (
          <section className='mb-7'>
            <h2 className='text-sm font-semibold text-ink'>{C.connect.heading}</h2>
            <p className='mb-2.5 mt-0.5 text-[13px] leading-relaxed text-gray-500'>{C.connect.rationale}</p>
            <div className='overflow-hidden rounded-xl border border-gray-200 bg-white'>
              <MobileList>
                {!whatsappConnected && (
                  <MobileListRow
                    href={C.connect.whatsapp.href as Route}
                    onClick={markConnectIntent}
                    className='press'
                    title={C.connect.whatsapp.title}
                    subtitle={C.connect.whatsapp.description}
                    leading={<WhatsappBadge size='sm' />}
                  />
                )}
                {!metaConnected && (
                  <MobileListRow
                    href={C.connect.meta.href as Route}
                    onClick={markConnectIntent}
                    className='press'
                    title={C.connect.meta.title}
                    subtitle={C.connect.meta.description}
                    leading={<MetaLeadAdsBadge size='sm' />}
                  />
                )}
              </MobileList>
            </div>
          </section>
        )}

        {/* Reassurance for the already-connected workspace, kept quiet and last. */}
        {bothConnected && (
          <p className='mt-6 text-center text-[13px] text-gray-400'>
            {C.connect.whatsapp.title} · {C.connect.meta.title} — {C.statusConnected}
          </p>
        )}
      </div>

      <LeadFormMobile
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onCreated={(leadId) => {
          recordFirstLeadEvent('first_manual_lead_created').catch(() => {})
          router.push(`/clients/${leadId}/summary?firstLead=1`)
        }}
      />
      <LeadImportMobile
        open={importOpen}
        onClose={() => setImportOpen(false)}
        /* Hand the user into the first-lead loop rather than a refreshed list. */
        onImported={(inserted, firstId, skipped) => {
          const qs = new URLSearchParams({ firstImport: String(inserted) })
          if (firstId) qs.set('firstLeadId', String(firstId))
          if (skipped) qs.set('firstImportSkipped', String(skipped))
    if (skipped) qs.set('firstImportSkipped', String(skipped))
          router.push(`/leads?${qs.toString()}`)
        }}
      />
    </>
  )
}
