import type { ScreenCopy } from '@/lib/activation/activationCopy'
import ActivationCtaButton from '@/components/activation/ActivationCtaButton'

export default function WaitingScreen({ copy, onCta }: { copy: ScreenCopy; onCta: () => void }) {
  return (
    <div className='flex flex-col items-center gap-6 text-center'>
      <h1 className='max-w-[360px] text-[26px] font-bold leading-tight text-white'>{copy.heading}</h1>
      <ActivationCtaButton label={copy.ctaLabel ?? ''} loadingLabel={copy.ctaLoadingLabel ?? ''} onClick={onCta} />
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
