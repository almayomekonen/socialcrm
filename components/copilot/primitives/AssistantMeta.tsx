import { fmtTime } from './fmt'

export function AssistantMeta({ time }: { time: string }) {
  return (
    <time className='text-xs text-gray-400 tracking-wide' dateTime={time}>
      {fmtTime(time)}
    </time>
  )
}
