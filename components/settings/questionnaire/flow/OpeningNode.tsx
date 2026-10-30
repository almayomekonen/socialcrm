'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { rowsFor } from '../builderCopy'
import { OPENING } from '@/lib/inbox/autoresponse/questionnaire/builder/flowGraph'
import { useFlowEditor } from './flowContext'
import ArrowInsertButton from './ArrowInsertButton'
import { customerTextAttrs } from '@/lib/i18n/config'
import { useRegionAttrs, useT } from '@/lib/i18n/I18nProvider'

/**
 * Where the conversation starts: the customer writes, and this is the first
 * thing they receive. Drawn as a WhatsApp message, not as a question box.
 */
export default function OpeningNode({ selected }: NodeProps) {
  const { model, edit, issuesFor, leave, select } = useFlowEditor()
  const t = useT()
  const dir = useRegionAttrs().dir ?? 'rtl'
  const missing = issuesFor('opening').some((i) => i.field === 'opening')

  if (!selected) {
    return (
      <div dir={dir} className='grid w-[300px] gap-1.5'>
        <div className='flex items-center justify-between'>
          <p className='text-xs text-gray-500'>{t('admin.questionnaireFlow.opening.atRest')}</p>
          <button type='button' onClick={() => select('opening')} aria-label={t('admin.questionnaireFlow.opening.edit')} className='nodrag rounded px-1.5 text-xs text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary'>
            {t('admin.questionnaireFlow.edit')}
          </button>
        </div>
        <p {...customerTextAttrs(t.locale)} className={`line-clamp-4 whitespace-pre-line rounded-2xl rounded-bl-sm bg-[#25D366]/15 px-3 py-2 text-sm leading-relaxed ${missing ? 'ring-1 ring-red-300' : ''}`}>
          {model.opening.trim() || t('admin.questionnaireFlow.opening.empty')}
        </p>
        <Handle type='source' position={Position.Bottom} id='next' isConnectable={false} className='!opacity-0' />
        <ArrowInsertButton nodeId={OPENING} />
      </div>
    )
  }

  return (
    <div
      dir={dir}
      onBlurCapture={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && leave('opening')}
      className='grid w-[340px] gap-2 rounded-xl border border-primary bg-white p-3.5 shadow-sm'
    >
      <label htmlFor='flow-opening' className='text-xs font-semibold text-gray-600'>
        {t('admin.questionnaireFlow.opening.label')}
      </label>
      <textarea
        id='flow-opening'
        value={model.opening}
        rows={rowsFor(model.opening, 2, 8)}
        aria-invalid={missing}
        {...customerTextAttrs(t.locale)}
        onChange={(e) => edit((m) => ({ ...m, opening: e.target.value }))}
        className='nodrag nowheel resize-none rounded-md border border-gray-200 bg-white px-2.5 py-2 text-sm leading-relaxed focus:outline-2 focus:outline-primary aria-invalid:border-red-400'
      />
      {missing && <p className='text-xs text-red-700'>{t('admin.questionnaireFlow.opening.missing')}</p>}
      <Handle type='source' position={Position.Bottom} id='next' isConnectable={false} className='!opacity-0' />
        <ArrowInsertButton nodeId={OPENING} />
    </div>
  )
}
