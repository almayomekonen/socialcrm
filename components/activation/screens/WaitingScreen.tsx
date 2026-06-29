import type { ScreenCopy } from '@/lib/activation/activationCopy'
import { Btn } from '@/lib/btns/Btn'
import ActivationProgress from '@/components/activation/ActivationProgress'
import ActivationBrand from '@/components/activation/ActivationBrand'

export default function WaitingScreen({
  copy,
  progress,
  onCta,
}: {
  copy: ScreenCopy
  progress: number
  onCta: () => void
}) {
  return (
    <div className='flex flex-col items-center gap-6 text-center'>
      <ActivationBrand />
      <ActivationProgress label={copy.progressLabel} progress={progress} />
      <h1 className='max-w-[320px] text-[26px] font-bold leading-tight text-white'>{copy.heading}</h1>
      <Btn lbl={copy.ctaLabel ?? ''} onClick={onCta} className='w-full max-w-[320px] justify-center' />
      {copy.trust && (
        <ul className='flex flex-col gap-1 text-[12px] text-white/50'>
          {copy.trust.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
