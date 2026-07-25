'use client'

import { useState } from 'react'
import type { Template } from '@/lib/whatsapp/templates/types'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import TemplateStatusBadge from './TemplateStatusBadge'
import TemplateRejectionNotice from './TemplateRejectionNotice'
import TemplatePendingNotice from './TemplatePendingNotice'
import { hasPositionalPlaceholder } from '@/lib/whatsapp/templates/parameters'

export type TemplateRowActions = {
  onArchive: (id: number) => void
  onDiscard: (id: number) => void
  onRetry: (template: Template) => void
  /** Safe edit-in-place of an approved template (optional; admin-gated server-side). */
  onEdit?: (template: Template) => void
}

export default function TemplateRow({ template, actions }: { template: Template; actions?: TemplateRowActions }) {
  const [confirm, setConfirm] = useState<null | 'archive' | 'discard'>(null)

  const canArchive = !!actions && (template.status === 'approved' || template.status === 'paused' || template.status === 'disabled')
  const canDiscard = !!actions && (template.status === 'pending' || template.status === 'rejected')
  const canRetry = !!actions && template.status === 'rejected'
  // Editable only when the body is in the user-facing chip form. A body that still
  // carries raw positional {{n}} is an unmapped Meta-synced template we can't safely
  // hydrate — never feed that into the editor; it routes to create-new instead.
  const canEdit = !!actions?.onEdit && template.status === 'approved' && !hasPositionalPlaceholder(template.bodyText)

  return (
    <div className='rounded-md border border-gray-200 p-3'>
      <div className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <p className='truncate text-sm font-medium text-gray-800'>{template.displayTitle}</p>
          <p className='line-clamp-1 text-sm text-gray-500'>{template.bodyText || '—'}</p>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          <TemplateStatusBadge status={template.status} />
          {canEdit && <Btn lbl='עריכת הודעה' variant='ghost' size='small' onClick={() => actions!.onEdit!(template)} />}
          {canRetry && <Btn lbl='ערוך ונסה שוב' variant='ghost' size='small' onClick={() => actions!.onRetry(template)} />}
          {canArchive && <Btn lbl='ארכיון' variant='ghost' size='small' onClick={() => setConfirm('archive')} />}
          {canDiscard && <Btn lbl='הסר' variant='ghost' size='small' onClick={() => setConfirm('discard')} />}
        </div>
      </div>

      {template.status === 'rejected' && template.failureText && (
        <div className='mt-2'>
          <TemplateRejectionNotice failureText={template.failureText} />
        </div>
      )}

      {template.status === 'pending' && (
        <div className='mt-2'>
          <TemplatePendingNotice />
        </div>
      )}

      <ConfirmPop
        open={confirm === 'archive'}
        destructive
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          actions?.onArchive(template.id)
        }}
        msg={`להעביר את "${template.displayTitle}" לארכיון?`}
      />
      <ConfirmPop
        open={confirm === 'discard'}
        destructive
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          actions?.onDiscard(template.id)
        }}
        msg={`להסיר את "${template.displayTitle}"?`}
      />
    </div>
  )
}
