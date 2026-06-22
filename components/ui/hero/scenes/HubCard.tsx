// The composition's focal point: all leads, gathered in one place. Largest and
// most prominent card in the cluster. Presentational only.
export function HubCard() {
  return (
    <div
      dir='rtl'
      className='w-72 overflow-hidden rounded-2xl bg-white ring-1 ring-black/5 shadow-[0_26px_70px_rgba(23,20,36,0.22)]'
    >
      {/* Brand accent bar — taller, so the focal card announces itself first */}
      <div className='h-1.5 w-full bg-[#3f20f5]' />
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
