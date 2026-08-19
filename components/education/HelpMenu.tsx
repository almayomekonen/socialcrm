'use client'

import { usePathname, useRouter } from 'next/navigation'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { recordEducationEvent } from '@/actions/education/recordEducationEvent'
import { useEducation } from './EducationProvider'

export default function HelpMenu({ onClose }: { onClose: () => void }) {
  const { startTour, copilotEnabled } = useEducation()
  const pathname = usePathname()
  const router = useRouter()

  function act(action: string, run: () => void) {
    recordEducationEvent('help_action_clicked', { action }).catch(() => {})
    run()
  }

  return (
    <ModalPop open onClose={onClose} pos='middle' labelledBy='help-menu-title' closeOutside className='w-[min(100%,24rem)]'>
      <div dir='rtl' className='grid gap-4 text-start'>
        <div>
          <h2 id='help-menu-title' className='text-lg font-bold text-ink'>
            עזרה
          </h2>
          <p className='mt-1 text-sm text-gray-600'>סיור קצר, מדריכים, או דיווח על בעיה.</p>
        </div>

        <Btn
          lbl='הראה לי איך המערכת עובדת'
          icon='map'
          onClick={() =>
            act('overview', () => {
              onClose()
              startTour('overview', { force: true, source: 'help' })
            })
          }
        />
        <Btn
          variant='outline'
          lbl='סיור בלידים'
          icon='image-polaroid-user'
          onClick={() =>
            act('pipeline', () => {
              onClose()
              if (pathname.startsWith('/leads')) startTour('pipeline', { force: true, source: 'help' })
              else router.push('/leads?tour=pipeline')
            })
          }
        />
        <Btn
          variant='outline'
          lbl='מדריכים'
          icon='book-open'
          href='/support/guides'
          onClick={() => recordEducationEvent('help_action_clicked', { action: 'guides' }).catch(() => {})}
        />
        <Btn
          variant='ghost'
          lbl='יש לי בעיה'
          icon='circle-exclamation'
          href='/support/new?kind=problem'
          onClick={() => recordEducationEvent('help_action_clicked', { action: 'problem' }).catch(() => {})}
        />

        {copilotEnabled && <p className='text-xs text-gray-500'>J + ⌘  העוזר החכם</p>}
      </div>
    </ModalPop>
  )
}
