'use client'

import Icon from '@/lib/Icon'
import { HELP_TRIGGER_EDU } from '@/lib/education'
import { useEducation } from './EducationProvider'

export default function HelpTrigger() {
  const { openHelp, helpOpen, toursEnabled, surface } = useEducation()
  if (!toursEnabled || surface !== 'desktop') return null

  return (
    <button
      type='button'
      data-edu={HELP_TRIGGER_EDU}
      onClick={openHelp}
      aria-label='עזרה'
      aria-expanded={helpOpen}
      aria-haspopup='dialog'
      title='עזרה'
      className={[
        'inline-flex items-center justify-center size-7 rounded-full transition-colors duration-150',
        'border focus:outline-none focus:ring-2 focus:ring-primary',
        helpOpen ? 'bg-gray-900 border-gray-900 hover:bg-gray-800' : 'bg-white border-gray-200 hover:bg-gray-50',
      ].join(' ')}
    >
      <Icon
        name='circle-question'
        type='sol'
        className={`size-3.5 transition-colors duration-150 ${helpOpen ? 'bg-white' : 'bg-primary'}`}
      />
    </button>
  )
}
