'use client'

import Icon from '@/lib/Icon'
import { useCopilot } from '@/lib/copilot/useCopilot'

export default function CopilotTopbarTrigger() {
  const { enabled, open, toggle } = useCopilot()
  if (!enabled) return null

  return (
      <button
        type='button'
        onClick={toggle}
        data-edu='copilot-trigger'
        aria-label='עוזר חכם'
      aria-expanded={open}
      aria-keyshortcuts='Meta+J Control+J'
      title='עוזר חכם · ⌘J'
      className={[
        'inline-flex items-center justify-center size-7 rounded-full transition-colors duration-150',
        'border focus:outline-none focus:ring-2 focus:ring-primary',
        open
          ? 'bg-gray-900 border-gray-900 hover:bg-gray-800'
          : 'bg-white border-gray-200 hover:bg-gray-50',
      ].join(' ')}
    >
      <Icon
        name='sparkles'
        type='sol'
        className={`size-3.5 transition-colors duration-150 ${open ? 'bg-white' : 'bg-primary'}`}
      />
    </button>
  )
}
