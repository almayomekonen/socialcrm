import Link from 'next/link'
import type { Route } from 'next'
import Icon from '@/lib/Icon'

/** Empty inbox — same copy as the previous server-rendered list. */
export default function EmptyConversationsMobile({ q }: { q: string }) {
  if (q) {
    return (
      <div className='flex flex-col items-center gap-4 px-6 py-14 text-center'>
        <span className='flex size-12 items-center justify-center rounded-full bg-gray-100'>
          <Icon name='magnifying-glass' type='reg' className='size-5 bg-gray-400' />
        </span>
        <div className='max-w-[300px]'>
          <h2 className='text-base font-bold text-ink'>לא נמצאו שיחות</h2>
          <p className='mt-1 text-sm leading-relaxed text-gray-500'>{`אין תוצאות עבור "${q}".`}</p>
        </div>
        <Link
          href={'/inbox' as Route}
          className='flex min-h-11 items-center rounded-md bg-solid px-5 font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        >
          נקה חיפוש
        </Link>
      </div>
    )
  }

  return (
    <div className='flex flex-col items-center gap-4 px-6 py-14 text-center'>
      <span className='flex size-14 items-center justify-center rounded-2xl bg-[#25D366]/10'>
        <Icon name='whatsapp' type='sol' className='size-6 bg-[#25D366]' />
      </span>
      <div className='max-w-[320px]'>
        <h2 className='text-lg font-bold leading-tight text-ink'>אין עדיין שיחות</h2>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-500'>
          כשלקוח ישלח הודעה בוואטסאפ, השיחה תופיע כאן.
        </p>
      </div>
      <Link
        href={'/settings/integrations' as Route}
        className='flex min-h-11 items-center rounded-md border border-gray-200 bg-white px-5 font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      >
        הגדרות וואטסאפ
      </Link>
    </div>
  )
}
