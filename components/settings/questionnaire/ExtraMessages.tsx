'use client'

import { useState } from 'react'
import AutoResponseTextField from '@/components/settings/autoResponse/AutoResponseTextField'
import type { EditorIssue } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { issueTextIn } from './issueText'
import { useT } from '@/lib/i18n/I18nProvider'

type Edit = (change: (m: BuilderQuestionnaire) => BuilderQuestionnaire) => void

/**
 * The two texts most owners never change: the message sent when the chat moves
 * to a נציג, and the title of the summary the נציג receives. Closed until
 * opened, unless one of them needs fixing.
 */
export default function ExtraMessages({
  model,
  edit,
  issues,
}: {
  model: BuilderQuestionnaire
  edit: Edit
  issues: EditorIssue[]
}) {
  const t = useT()
  const handoffIssue = issues.find((i) => i.field === 'handoffMessage')
  const titleIssue = issues.find((i) => i.field === 'summaryTitle')
  const [open, setOpen] = useState(Boolean(handoffIssue || titleIssue))
  const expanded = open || Boolean(handoffIssue || titleIssue)

  return (
    <section className='rounded-lg border border-gray-200 bg-white p-5'>
      <button
        type='button'
        aria-expanded={expanded}
        aria-controls='questionnaire-extra'
        onClick={() => setOpen((o) => !o)}
        className='text-sm font-semibold text-gray-700 underline-offset-2 hover:underline'
      >
        {t('admin.questionnaire.extra.title')}
      </button>
      {expanded && (
        <div id='questionnaire-extra' className='mt-4 grid gap-5'>
          <AutoResponseTextField
            id='questionnaire-handoff'
            label={t('admin.questionnaire.extra.handoff')}
            hint={t('admin.questionnaire.extra.handoffHint')}
            value={model.handoffMessage}
            onChange={(v) => edit((m) => ({ ...m, handoffMessage: v }))}
            placeholder=''
            maxLength={900}
            sent
            rows={2}
            error={handoffIssue ? issueTextIn(handoffIssue, model, t) : undefined}
            translated
          />
          <AutoResponseTextField
            id='questionnaire-summary-title'
            label={t('admin.questionnaire.extra.summary')}
            hint={t('admin.questionnaire.extra.summaryHint')}
            value={model.summaryTitle}
            onChange={(v) => edit((m) => ({ ...m, summaryTitle: v }))}
            placeholder=''
            maxLength={80}
            sent={false}
            rows={1}
            error={titleIssue ? issueTextIn(titleIssue, model, t) : undefined}
            translated
          />
        </div>
      )}
    </section>
  )
}
