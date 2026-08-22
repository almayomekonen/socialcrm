'use client'

import { useState } from 'react'
import Icon from '@/lib/Icon'
import ModalPop from '@/lib/modals/ModalPop'
import ClientFormPop from '@/components/clients/ClientFormPop'
import UploadClientData from '@/components/settings/UploadClientData'

/**
 * The ZERO-DATA state of the assistant — a real interactive state, not a
 * disabled panel. The composer stays mounted alongside it.
 *
 * `hasAnyLeads` (surfaced as `briefing.kind === 'empty'`) decides what is rendered
 * INSIDE the panel; it never decides whether the panel is usable. This is distinct
 * from `kind === 'locked'`, which is an ENTITLEMENT state owned by
 * SubscriptionExpiredState in the panel body — the two are never collapsed.
 *
 * Both actions invoke the SAME mechanisms the /leads first-run screen uses —
 * `ClientFormPop` and `UploadClientData` inside a `ModalPop` (see
 * components/clients/LeadsFirstRun.tsx). Nothing is re-implemented, and neither
 * button is a deep link: the previous version pointed both CTAs at `/leads`, which
 * navigated away from the assistant without opening any flow. `ModalPop` portals to
 * document.body, so the 320px panel never clips the form.
 *
 * Entitlement is unchanged by this component. Creating a lead is a CRM action, not
 * a paid AI request, and `upsertLead` keeps enforcing quota server-side (it returns
 * `quota_exceeded`, which ClientFormPop renders as the existing QuotaPaywallModal).
 * A locked account never reaches this state at all — the server returns
 * `kind: 'locked'`, and the locked branch owns the body.
 *
 * Creation analytics are emitted server-side by `upsertLead` (`lead_created_manual`
 * + `trackFirstRealLeadOnce`), so this surface adds no analytics of its own.
 * `first_manual_lead_created` is deliberately NOT fired here — it is documented as
 * a first-run-screen marker, and firing it from a second surface would change what
 * the existing metric means.
 */
export default function GeneralEmptyState({ onDataChanged }: { onDataChanged?: () => void }) {
  const [openForm, setOpenForm] = useState(false)
  const [openUpload, setOpenUpload] = useState(false)

  return (
    <div className='flex h-full flex-col items-center justify-center gap-4 px-5 py-6 text-center'>
      <Icon name='sparkles' type='reg' className='size-6 bg-gray-300' />

      <div className='space-y-1'>
        <p className='text-sm font-medium text-gray-700'>עדיין אין לך לידים</p>
        <p className='text-xs leading-relaxed text-gray-500'>
          העוזר החכם עונה על שאלות מתוך הלידים שלך. ברגע שיהיו לידים במערכת, הוא יוכל להגיד לך במי לטפל עכשיו ומי מחכה לתשובה.
        </p>
      </div>

      <div className='flex w-full max-w-55 flex-col gap-2'>
        <button
          type='button'
          onClick={() => setOpenForm(true)}
          className='rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800'
        >
          צור ליד
        </button>
        <button
          type='button'
          onClick={() => setOpenUpload(true)}
          className='rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50'
        >
          ייבא לידים
        </button>
      </div>

      <ModalPop open={openForm} label='פרטי ליד' pos='middle' onClose={() => setOpenForm(false)}>
        <ClientFormPop
          client={null}
          onClose={() => setOpenForm(false)}
          onCreated={() => {
            // Stay in the assistant. The workspace now has data, so re-reading the
            // briefing turns this very panel into the real AI experience — the
            // opposite of the dead end that navigating away produced.
            setOpenForm(false)
            onDataChanged?.()
          }}
        />
      </ModalPop>

      {/* UploadClientData owns its own post-import refresh and exposes no completion
          callback; re-reading the briefing on close is how the panel picks up an
          import without modifying the existing import flow. */}
      <ModalPop
        open={openUpload}
        label='העלאת לידים'
        pos='middle'
        onClose={() => {
          setOpenUpload(false)
          onDataChanged?.()
        }}
      >
        <UploadClientData />
      </ModalPop>
    </div>
  )
}
