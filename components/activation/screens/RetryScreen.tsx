import type { ScreenCopy } from '@/lib/activation/activationCopy'
import ActivationCtaButton from '@/components/activation/ActivationCtaButton'

export default function RetryScreen({ copy, onRetry }: { copy: ScreenCopy; onRetry: () => void }) {
  return (
    <div className='flex flex-col items-center gap-5 text-center'>
      <h1 className='text-[22px] font-bold text-white desktop:text-[#0f1024]'>{copy.heading}</h1>
      {copy.body && <p className='max-w-[320px] text-[14px] text-white/70 desktop:text-gray-500'>{copy.body}</p>}
      <ActivationCtaButton label={copy.ctaLabel ?? ''} loadingLabel={copy.ctaLoadingLabel ?? ''} onClick={onRetry} />
    </div>
  )
}
