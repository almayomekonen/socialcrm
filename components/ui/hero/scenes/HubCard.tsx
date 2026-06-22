// The composition's focal point: all leads, gathered in one place. Largest and
// most prominent card in the cluster. Presentational only.
export function HubCard() {
  return (
    <div
      dir='rtl'
      className='w-64 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_18px_50px_rgba(23,20,36,0.16)]'
    >
      {/* Brand accent bar */}
      <div className='h-1 w-full bg-[#3f20f5]' />
      <div className='p-4'>
        <div className='flex items-center justify-between gap-2'>
          <span className='text-base font-bold text-gray-900'>SocialCRM</span>
          <span className='rounded-full bg-[#3f20f5]/10 px-2.5 py-1 text-xs font-semibold text-[#3f20f5]'>
            12 לידים ממתינים
          </span>
        </div>
        <p className='mt-1 text-xs text-gray-500'>כל הלידים במקום אחד</p>
      </div>
    </div>
  )
}
