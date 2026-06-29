import type { ScreenCopy } from '@/lib/activation/activationCopy'
import { Btn } from '@/lib/btns/Btn'

export default function RetryScreen({ copy, onRetry }: { copy: ScreenCopy; onRetry: () => void }) {
  return (
    <div className='flex flex-col items-center gap-5 text-center'>
      <h1 className='text-[22px] font-bold text-white'>{copy.heading}</h1>
      {copy.body && <p className='max-w-[320px] text-[14px] text-white/70'>{copy.body}</p>}
      <Btn lbl={copy.ctaLabel ?? ''} onClick={onRetry} className='w-full max-w-[320px] justify-center' />
    </div>
  )
}
