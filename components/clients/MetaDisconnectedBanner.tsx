'use client'

export default function MetaDisconnectedBanner({ show }: { show: boolean }) {
  if (!show) return null

  return (
    <div className='mb-4 flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3'>
      <p className='text-sm font-semibold text-amber-900'>
        חשבון ה‑Meta מנותק. לידים חדשים לא ייכנסו עד שתחבר אותו מחדש.
      </p>
      <a
        href='/settings/facebook'
        className='shrink-0 rounded-md bg-solid px-4 py-2 text-sm font-semibold text-white hover:bg-solid/85'
      >
        חבר מחדש
      </a>
    </div>
  )
}
