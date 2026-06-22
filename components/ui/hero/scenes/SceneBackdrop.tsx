// Sits behind the hero card cluster and shares its footprint, so the group reads
// as a single object rather than scattered cards. Purely decorative.
export function SceneBackdrop() {
  return (
    <div aria-hidden='true' className='pointer-events-none absolute inset-0'>
      {/* Soft purple radial glow centered on the cluster */}
      <div className='absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(63,32,245,0.18),transparent_65%)]' />

      {/* One organic blurred blob, brand-tinted */}
      <div className='absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#9c87fa]/30 blur-3xl' />

      {/* Sparse accent shapes — restrained */}
      <div className='absolute right-[12%] top-[14%] h-2.5 w-2.5 rounded-full bg-[#3f20f5]/40' />
      <div className='absolute left-[16%] top-[26%] h-3 w-3 rotate-45 rounded-[3px] bg-[#7b62f8]/40' />
      <div className='absolute bottom-[16%] right-[20%] h-2 w-2 rounded-full bg-[#bdb0fc]/60' />
    </div>
  )
}
