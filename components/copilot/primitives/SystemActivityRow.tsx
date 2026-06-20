import type { CopilotActionId } from '@/lib/copilot/copilotResponse'
import { fmtTime, systemLabel } from './fmt'

export function SystemActivityRow({
  text,
  actionId,
  createdAt,
}: {
  text: string
  actionId: CopilotActionId | null
  createdAt: string
}) {
  return (
    <div className='flex items-center gap-1.5 text-xs text-gray-400 tracking-wide'>
      <span className='truncate'>{systemLabel(actionId, text)}</span>
      <span aria-hidden='true' className='text-gray-300'>
        ·
      </span>
      <time dateTime={createdAt}>{fmtTime(createdAt)}</time>
    </div>
  )
}
