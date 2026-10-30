'use client'

import { describeConditionIn } from './issueText'
import { useT } from '@/lib/i18n/I18nProvider'
import { conditionOf, conditionSources, keyOf, setShownWhen } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderQuestion, BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import ConditionEditor from './ConditionEditor'

type Edit = (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => void

/**
 * "מתי השאלה תופיע", sized to how much it matters for this question.
 *
 *   · Nothing to depend on (no earlier choice question): not shown at all.
 *   · Always shown: one quiet line with a link, so a business that never
 *     branches never has to think about it.
 *   · Shown after an answer: the sentence, prominent, with "שינוי" to open
 *     the editor.
 * Drawn once, under the card's title, so the route a question belongs to is
 * the first thing read about it.
 */
export default function QuestionWhen({
  model,
  question,
  edit,
  editing,
  setEditing,
}: {
  model: BuilderQuestionnaire
  question: BuilderQuestion
  edit: Edit
  /** Owned by the card: this section moves (bottom → top) when a condition appears. */
  editing: boolean
  setEditing: (editing: boolean) => void
}) {
  const t = useT()
  const key = keyOf(question)
  const condition = conditionOf(question)
  const sources = conditionSources(model, key)
  // A condition still being built (no answer ticked yet) stays open.
  const open = editing || (condition !== null && condition.anyOf.length === 0)

  if (!condition && !sources.length && !open) return null

  if (open) {
    return (
      <div className='grid gap-2 rounded-md border border-gray-200 bg-gray-50 p-3'>
        <ConditionEditor
          model={model}
          sources={sources}
          condition={condition}
          onChange={(c) => edit((m) => setShownWhen(m, key, c))}
          allowAlways
          legend={t('admin.questionnaire.when.legend')}
          sentencePrefix={t('admin.questionnaire.when.prefix')}
        />
        <div>
          <button
            type='button'
            onClick={() => setEditing(false)}
            className='text-sm font-medium text-ink underline underline-offset-2'
          >
            {t('admin.questionnaire.when.done')}
          </button>
        </div>
      </div>
    )
  }

  if (condition) {
    return (
      <p className='flex flex-wrap items-baseline gap-x-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-800'>
        <span>
          <span className='font-medium'>{t('admin.questionnaire.when.prefix')}</span> {describeConditionIn(model, condition, t)}
        </span>
        <button type='button' onClick={() => setEditing(true)} className='text-xs text-gray-600 underline underline-offset-2'>
          {t('admin.questionnaire.when.change')}
        </button>
      </p>
    )
  }

  return (
    <p className='text-xs text-gray-600'>
      {t('admin.questionnaire.when.always')}{' '}
      <button
        type='button'
        onClick={() => {
          // Straight to "which answers?": the nearest earlier choice question, nothing ticked yet.
          edit((m) => setShownWhen(m, key, { questionId: keyOf(sources[sources.length - 1]), anyOf: [] }))
          setEditing(true)
        }}
        className='underline underline-offset-2'
      >
        {t('admin.questionnaire.when.byAnswer')}
      </button>
    </p>
  )
}
