import { ChannelBadges } from './ChannelBadges'
import { Btn } from '@/lib/btns/Btn'

export function HeroContent() {
  return (
    <div dir='rtl' className='flex flex-col items-start text-right'>

      <ChannelBadges />

      <h1 className='text-[3.65rem] font-black leading-[1.03] text-gray-900 sm:text-4xl sm:leading-[1.1] md:text-6xl'>
        כל הלידים במקום אחד
        <br />
        <span className='text-[#3f20f5]'>כל העסק בשליטה אחת</span>
      </h1>

      <p className='mt-6 max-w-md text-lg text-gray-600'>
        כל הלידים מוואטסאפ, פייסבוק ואינסטגרם מרוכזים אצלכם, עוקבים בזמן וסוגרים יותר עסקאות.
      </p>

      <div className='mt-8 flex flex-wrap items-center gap-3'>
        <Btn
          href='/auth'
          lbl='התחל בחינם'
          className='h-auto rounded-xl bg-[#3f20f5] hover:bg-[#3f20f5] px-7 py-3.5 font-bold text-white transition-transform duration-200 hover:scale-105'
        />
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
