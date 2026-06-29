import type { ScreenCopy } from '@/lib/activation/activationCopy'
import Icon from '@/lib/Icon'

export default function WorkingScreen({ copy }: { copy: ScreenCopy }) {
  return (
    <div className='flex flex-col items-center gap-5 text-center'>
      <Icon name='spinner' className='size-8 animate-spin bg-white/80' />
      <h1 className='text-[20px] font-medium text-white/90'>{copy.heading}</h1>
    </div>
  )
}
