import Link from 'next/link'

const CHANNELS = ['וואטסאפ', 'פייסבוק', 'אינסטגרם']

export function HeroContent() {
  return (
    <div dir='rtl' className='flex flex-col items-start text-right'>

      <div className='mb-6 flex flex-wrap gap-2'>
        {CHANNELS.map((channel) => (
          <span
            key={channel}
            className='rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-500'
          >
            {channel}
          </span>
        ))}
      </div>

      <h1 className='text-4xl font-black leading-[1.1] text-gray-900 md:text-6xl'>
        כל ליד.
        <br />
        במקום אחד.
        <br />
        <span className='text-[#3f20f5]'>בלי לפספס.</span>
      </h1>

      <p className='mt-6 max-w-md text-lg text-gray-600'>
        כל הלידים מוואטסאפ, פייסבוק ואינסטגרם מרוכזים אצלכם, עוקבים בזמן וסוגרים יותר עסקאות.
      </p>

      <div className='mt-8 flex flex-wrap items-center gap-3'>
        <Link
          href='/auth/register'
          className='rounded-xl bg-[#3f20f5] px-7 py-3.5 font-bold text-white transition-transform duration-200 hover:scale-105'
        >
          התחל בחינם
        </Link>
        <a
          href='#how-it-works'
          className='rounded-xl border border-gray-300 px-7 py-3.5 font-semibold text-gray-800 transition-colors duration-200 hover:border-gray-400'
        >
          איך זה עובד
        </a>
      </div>
    </div>
  )
}
