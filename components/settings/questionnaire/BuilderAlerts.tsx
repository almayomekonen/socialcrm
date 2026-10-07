'use client'

import { Btn } from '@/lib/btns/Btn'
import { describeIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/issues'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { ConflictKind } from '@/hooks/useQuestionnaireDraft'
import type { ReleaseState } from '@/hooks/useQuestionnaireRelease'
import { CONFLICT_COPY, FAILURE_COPY } from './builderCopy'

/**
 * The three things that stop the owner, each said once and plainly: another
 * tab changed the draft (autosave stopped; reload, never overwrite), the
 * questionnaire could not be opened, or publishing was refused (with the
 * problems, in Hebrew).
 */
export default function BuilderAlerts({
  conflict,
  failure,
  release,
  model,
  onDismiss,
}: {
  conflict: ConflictKind | null
  failure: string | null
  release: ReleaseState
  model: BuilderQuestionnaire | null
  onDismiss: () => void
}) {
  return (
    <>
      {conflict && (
        <div
          role='alert'
          className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3'
        >
          <p className='text-sm text-gray-900'>{CONFLICT_COPY[conflict]}</p>
          <Btn type='button' variant='outline' lbl='טעינת הגרסה העדכנית' onClick={() => window.location.reload()} />
        </div>
      )}
      {failure !== null && (
        <p role='alert' className='rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'>
          {FAILURE_COPY[failure] ?? 'לא הצלחנו לפתוח את השאלון. נסו לרענן את העמוד.'}
        </p>
      )}
      {release.kind === 'blocked' && (
        <div role='alert' className='grid gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3'>
          <p className='text-sm font-medium text-red-900'>{release.message}</p>
          {model && release.issues.length > 0 && (
            <ul className='list-disc ps-5 text-sm text-red-800'>
              {release.issues
                .filter((i) => i.severity === 'error')
                .map((i, n) => (
                  <li key={n}>{describeIssue(i, model)}</li>
                ))}
            </ul>
          )}
          <div>
            <Btn type='button' size='small' variant='outline' lbl='הבנתי' onClick={onDismiss} />
          </div>
        </div>
      )}
    </>
  )
}
