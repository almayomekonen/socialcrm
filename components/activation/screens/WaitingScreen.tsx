import type { ScreenCopy } from '@/lib/activation/activationCopy'
import ActivationCtaButton from '@/components/activation/ActivationCtaButton'

export default function WaitingScreen({ copy, onCta }: { copy: ScreenCopy; onCta: () => void }) {
  return (
    <div className='flex flex-col items-center gap-7 text-center'>
      <h1 className='max-w-[420px] text-[26px] font-bold leading-tight text-white desktop:text-[32px] desktop:text-[#0f1024]'>
        {copy.heading}
      </h1>
      <ActivationCtaButton label={copy.ctaLabel ?? ''} loadingLabel={copy.ctaLoadingLabel ?? ''} onClick={onCta} />
      {copy.trust && (
        <ul className='flex flex-col gap-1 text-[12px] text-white/50 desktop:text-gray-500'>
          {copy.trust.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
