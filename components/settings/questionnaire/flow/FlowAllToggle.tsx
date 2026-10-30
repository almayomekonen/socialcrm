'use client'

import { setAllowAll } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import { useFlowEditor } from './flowContext'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * The map's "אפשר לענות 'הכל'": a customer who answers "הכל" gets every option
 * except "אחר" (allKeyword.ts). Multi-select questions only, and only where the
 * agency reads natural answers. Same control as FlowOtherToggle.
 */
export default function FlowAllToggle({ questionKey, allowAll }: { questionKey: string; allowAll: boolean }) {
  const { edit } = useFlowEditor()
  const t = useT()
  return (
    <label className='flex items-center gap-1.5 text-xs text-gray-700'>
      <input
        type='checkbox'
        className='size-4 accent-solid'
        checked={allowAll}
        onChange={(e) => edit((m) => setAllowAll(m, questionKey, e.target.checked))}
      />
      {t('admin.questionnaireFlow.allToggle')}
    </label>
  )
}
