'use client'

import { Btn } from '@/lib/btns/Btn'
import type { SaveStatus } from '@/hooks/useQuestionnaireDraft'
import type { LiveRouting } from './builderCopy'
import { liveStatusTextIn, saveStatusIn } from './copyIn'
import { useT } from '@/lib/i18n/I18nProvider'

export type { LiveRouting }

/** Where the questionnaire stands, and the three things the owner does from here: test, see versions, publish. */
export default function BuilderHeader({
  liveRevision,
  routing,
  saveStatus,
  onTest,
  testing,
  onPreview,
  previewing = false,
  onHistory,
  onPublish,
  publishBusy,
  canEdit,
}: {
  liveRevision: number | null
  routing: LiveRouting
  saveStatus: SaveStatus
  onTest: () => void
  testing: boolean
  /** Flow view only: "how will this look to the customer?" opens the production preview. */
  onPreview?: () => void
  previewing?: boolean
  onHistory: () => void
  onPublish: () => void
  publishBusy: boolean
  canEdit: boolean
}) {
  const t = useT()
  const status = saveStatusIn(saveStatus, t)
  return (
    <header className='flex flex-wrap items-start justify-between gap-4'>
      <div className='grid gap-1'>
        <h1 className='text-xl font-semibold text-ink'>{t('admin.questionnaire.title')}</h1>
        <p className='text-sm text-gray-700'>{liveStatusTextIn(liveRevision, routing, t)}</p>
        <p className='text-xs text-gray-500' aria-live='polite'>
          {canEdit
            ? `${t('admin.questionnaire.header.editing')}${status ? ` ${status}` : ''}`
            : ''}
        </p>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        {onPreview && (
          <Btn type='button' variant='outline' icon='eye' lbl={t('admin.questionnaire.header.preview')} onClick={onPreview} aria-pressed={previewing} />
        )}
        <Btn
          type='button'
          variant='outline'
          icon='play'
          lbl={t('admin.questionnaire.header.test')}
          onClick={onTest}
          aria-pressed={testing}
          disabled={!canEdit}
        />
        <Btn type='button' variant='ghost' icon='clock-rotate-left' lbl={t('admin.questionnaire.header.history')} onClick={onHistory} />
        <Btn type='button' lbl={publishBusy ? t('admin.questionnaire.header.checking') : t('admin.questionnaire.header.publish')} onClick={onPublish} disabled={!canEdit || publishBusy} />
      </div>
    </header>
  )
}
