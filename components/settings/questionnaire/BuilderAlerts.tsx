'use client'

import { Btn } from '@/lib/btns/Btn'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import type { ConflictKind } from '@/hooks/useQuestionnaireDraft'
import type { ReleaseState } from '@/hooks/useQuestionnaireRelease'
import { conflictIn, failureIn, publishFailureIn } from './copyIn'
import { issueTextIn } from './issueText'
import { useT } from '@/lib/i18n/I18nProvider'
import { focusCard } from './focusCard'

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
  const t = useT()
  return (
    <>
      {conflict && (
        <div
          role='alert'
          className='flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3'
        >
          <p className='text-sm text-gray-900'>{conflictIn(conflict, t)}</p>
          <Btn type='button' variant='outline' lbl={t('admin.questionnaire.alerts.reload')} onClick={() => window.location.reload()} />
        </div>
      )}
      {failure !== null && (
        <p role='alert' className='rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800'>
          {failureIn(failure, t) ?? t('admin.questionnaire.alerts.openFailed')}
        </p>
      )}
      {release.kind === 'blocked' && (
        <div role='alert' className='grid gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3'>
          <p className='text-sm font-medium text-red-900'>{publishFailureIn(release.reason, t)}</p>
          {model && release.issues.length > 0 && (
            <ul className='list-disc ps-5 text-sm text-red-800'>
              {release.issues
                .filter((i) => i.severity === 'error')
                .map((i, n) => (
                  <li key={n}>
                    {issueTextIn(i, model, t)}{' '}
                    {(i.questionId || i.endingIndex !== undefined) && (
                      <button
                        type='button'
                        onClick={() =>
                          i.questionId
                            ? focusCard(i.questionId)
                            : document.getElementById('questionnaire-endings')?.scrollIntoView({ block: 'center' })
                        }
                        className='font-medium underline underline-offset-2'
                      >
                        {i.questionId ? t('admin.questionnaire.alerts.toQuestion') : t('admin.questionnaire.alerts.toEnding')}
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          )}
          <div>
            <Btn type='button' size='small' variant='outline' lbl={t('admin.questionnaire.alerts.ok')} onClick={onDismiss} />
          </div>
        </div>
      )}
    </>
  )
}
