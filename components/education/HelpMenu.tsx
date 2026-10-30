'use client'

import { usePathname, useRouter } from 'next/navigation'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { recordEducationEvent } from '@/actions/education/recordEducationEvent'
import { useEducation } from './EducationProvider'
import { useT } from '@/lib/i18n/I18nProvider'
import { regionAttrs } from '@/lib/i18n/config'

export default function HelpMenu({ onClose }: { onClose: () => void }) {
  const { startTour, copilotEnabled } = useEducation()
  const pathname = usePathname()
  const router = useRouter()
  const t = useT()
  // Hebrew keeps its explicit `dir='rtl'`; otherwise the dialog declares the interface language.
  const region = regionAttrs(t.locale)

  function act(action: string, run: () => void) {
    recordEducationEvent('help_action_clicked', { action }).catch(() => {})
    run()
  }

  return (
    <ModalPop open onClose={onClose} pos='middle' labelledBy='help-menu-title' closeOutside className='w-[min(100%,24rem)]' translated>
      <div dir={region.dir ?? 'rtl'} lang={region.lang} className='grid gap-4 text-start'>
        <div>
          <h2 id='help-menu-title' className='text-lg font-bold text-ink'>
            {t('shell.help')}
          </h2>
          <p className='mt-1 text-sm text-gray-600'>{t('education.help.body')}</p>
        </div>

        <Btn
          lbl={t('education.help.overview')}
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
          lbl={t('education.help.pipeline')}
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
          lbl={t('education.help.guides')}
          icon='book-open'
          href='/support/guides'
          onClick={() => recordEducationEvent('help_action_clicked', { action: 'guides' }).catch(() => {})}
        />
        <Btn
          variant='ghost'
          lbl={t('education.help.problem')}
          icon='circle-exclamation'
          href='/support/new?kind=problem'
          onClick={() => recordEducationEvent('help_action_clicked', { action: 'problem' }).catch(() => {})}
        />

        {copilotEnabled && <p className='text-xs text-gray-500'>{t('education.help.copilotHint')}</p>}
      </div>
    </ModalPop>
  )
}
