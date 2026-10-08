'use client'

import { Btn } from '@/lib/btns/Btn'
import type { SaveStatus } from '@/hooks/useQuestionnaireDraft'
import { SAVE_STATUS, liveStatusText, type LiveRouting } from './builderCopy'

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
  return (
    <header className='flex flex-wrap items-start justify-between gap-4'>
      <div className='grid gap-1'>
        <h1 className='text-xl font-semibold text-ink'>שאלון וואטסאפ</h1>
        <p className='text-sm text-gray-700'>{liveStatusText(liveRevision, routing)}</p>
        <p className='text-xs text-gray-500' aria-live='polite'>
          {canEdit
            ? `עורכים טיוטה. השינויים נשמרים אוטומטית ולא מגיעים ללקוחות עד הפרסום.${SAVE_STATUS[saveStatus] ? ` ${SAVE_STATUS[saveStatus]}` : ''}`
            : ''}
        </p>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        {onPreview && (
          <Btn type='button' variant='outline' icon='eye' lbl='איך זה ייראה ללקוח?' onClick={onPreview} aria-pressed={previewing} />
        )}
        <Btn
          type='button'
          variant='outline'
          icon='play'
          lbl='בדיקת השאלון'
          onClick={onTest}
          aria-pressed={testing}
          disabled={!canEdit}
        />
        <Btn type='button' variant='ghost' icon='clock-rotate-left' lbl='היסטוריית גרסאות' onClick={onHistory} />
        <Btn type='button' lbl={publishBusy ? 'בודק…' : 'פרסום'} onClick={onPublish} disabled={!canEdit || publishBusy} />
      </div>
    </header>
  )
}
