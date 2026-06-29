export default function ActivationProgress({ label, progress }: { label?: string; progress: number }) {
  return (
    <div className='w-full max-w-[320px]'>
      <div className='h-1.5 w-full overflow-hidden rounded-full bg-white/10'>
        <div
          className='h-full rounded-full bg-emerald-400 transition-[width] duration-700'
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      {label && <p className='mt-2 text-[12px] text-white/45'>{label}</p>}
    </div>
  )
}
