'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ModalPop from '@/lib/modals/ModalPop'
import ClientFormPop from './ClientFormPop'
import UploadClientData from '@/components/settings/UploadClientData'
import { MetaLeadAdsBadge } from '@/components/ui/MetaLeadAdsBadge'
import OnboardingActionCard from './OnboardingActionCard'
import { recordFirstLeadEvent } from '@/actions/analytics/recordFirstLeadEvent'

export default function LeadsFirstRun({
  metaConnected = false,
  whatsappConnected = false,
}: {
  metaConnected?: boolean
  whatsappConnected?: boolean
}) {
  const router = useRouter();
  const [openForm, setOpenForm] = useState(false);
  const [openUpload, setOpenUpload] = useState(false);

  return (
    <div dir='rtl' className='flex min-h-full w-full flex-col items-center justify-center px-6 py-16'>
      <div className='w-full max-w-2xl'>
        {metaConnected ? (
          <>
            <header className='mb-10 text-center'>
              <h1 className='text-4xl font-bold tracking-tight text-ink'>אין עדיין לידים</h1>
              <p className='mx-auto mt-3 max-w-xl text-lg leading-relaxed text-gray-600'>
                חשבון ה‑Meta שלך מחובר בהצלחה.
                <br />
                הליד הראשון יופיע כאן באופן אוטומטי ברגע שיגיע.
              </p>
            </header>

            {/* Same grid idiom as below. When WhatsApp is still unconnected we
                offer it as one more equal card (never a highlighted "next step"),
                and Import drops to a centered card on its own row — 2 + 1, so
                three cards stay balanced instead of reading as a checklist. */}
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <OnboardingActionCard
                onClick={() => setOpenForm(true)}
                icon='plus'
                tileClass='bg-ink'
                title='הוסף ליד'
                description='הוסף ליד ידנית עכשיו'
              />
              {!whatsappConnected && (
                <OnboardingActionCard
                  href='/settings/facebook?section=whatsapp'
                  icon='whatsapp'
                  tileClass='bg-[#25D366]'
                  title='חבר וואטסאפ'
                  description='קבל גם לידים מוואטסאפ אוטומטית'
                />
              )}
              <div className={whatsappConnected ? '' : 'sm:col-span-2 sm:mx-auto sm:w-[calc(50%-0.5rem)]'}>
                <OnboardingActionCard
                  onClick={() => setOpenUpload(true)}
                  icon='file-excel'
                  tileClass='bg-[#217346]'
                  title='ייבוא מאקסל'
                  description='העבר את כל הלקוחות בשניות'
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <header className='mb-10 text-center'>
              <h1 className='text-4xl font-bold tracking-tight text-ink'>בוא נכניס את הלידים שלך ל־SocialCRM</h1>
              <p className='mx-auto mt-3 max-w-xl text-lg leading-relaxed text-gray-600'>
                חבר את הערוצים שלך או הוסף לידים, ותוכל להתחיל לעבוד עם כל יכולות ה־Pro.
              </p>
            </header>

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <OnboardingActionCard
                href='/settings/facebook?section=whatsapp'
                icon='whatsapp'
                tileClass='bg-[#25D366]'
                title='וואטסאפ'
                description='נהל שיחות עם לקוחות במקום אחד'
                badge='מומלץ'
                badgeClass='bg-info-bg text-info-text'
              />
              <OnboardingActionCard
                href='/settings/facebook?section=facebook'
                tile={<MetaLeadAdsBadge size='lg' />}
                title='פייסבוק ואינסטגרם'
                description='קבל לידים מהמודעות אוטומטית'
              />
              <OnboardingActionCard
                onClick={() => setOpenForm(true)}
                icon='plus'
                tileClass='bg-ink'
                title='הוסף ליד ראשון'
                description='הדרך המהירה ביותר להתחיל'
              />
              <OnboardingActionCard
                onClick={() => setOpenUpload(true)}
                icon='file-excel'
                tileClass='bg-[#217346]'
                title='ייבוא מאקסל'
                description='העבר את כל הלקוחות בשניות'
              />
            </div>
          </>
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
        <UploadClientData />
      </ModalPop>
    </div>
  )
}
