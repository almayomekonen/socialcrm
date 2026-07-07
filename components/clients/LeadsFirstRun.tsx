'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ModalPop from '@/lib/modals/ModalPop'
import ClientFormPop from './ClientFormPop'
import UploadClientData from '@/components/settings/UploadClientData'
import { MetaLeadAdsBadge } from '@/components/ui/MetaLeadAdsBadge'
import OnboardingActionCard from './OnboardingActionCard'

export default function LeadsFirstRun({ metaConnected = false }: { metaConnected?: boolean }) {
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

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <OnboardingActionCard
                onClick={() => setOpenForm(true)}
                icon='plus'
                tileClass='bg-ink'
                title='הוסף ליד'
                description='הוסף ליד ידנית עכשיו'
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
        ) : (
          <>
            <header className='mb-10 text-center'>
              <h1 className='text-4xl font-bold tracking-tight text-ink'>חבר את העסק שלך</h1>
              <p className='mx-auto mt-3 max-w-xl text-lg leading-relaxed text-gray-600'>
                כל הלידים שלך במקום אחד ו‑SocialCRM כבר יסדר למי להתקשר קודם.
              </p>
            </header>

            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <OnboardingActionCard
                href='/settings/facebook'
                icon='whatsapp'
                tileClass='bg-[#25D366]'
                title='וואטסאפ'
                description='נהל שיחות עם לקוחות במקום אחד'
                badge='מומלץ'
                badgeClass='bg-info-bg text-info-text'
              />
              <OnboardingActionCard
                href='/settings/facebook'
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
        <ClientFormPop client={null} onClose={() => setOpenForm(false)} onCreated={() => router.refresh()} />
      </ModalPop>

      <ModalPop open={openUpload} label='העלאת לידים' pos='middle' onClose={() => setOpenUpload(false)}>
        <UploadClientData />
      </ModalPop>
    </div>
  )
}
