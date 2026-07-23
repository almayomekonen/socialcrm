import type { Template } from '@/lib/whatsapp/templates/types'
import TemplateStatusBadge from './TemplateStatusBadge'

/**
 * One ready-made message: owner title + one-line body preview + status pill.
 *
 * Read-only in Sprint 2 — row actions (retry / archive) and the rejection reason
 * line arrive in later sprints. Matches the skeleton's shape so loading→loaded
 * doesn't shift layout.
 */
export default function TemplateRow({ template }: { template: Template }) {
  return (
    <div className='flex items-center justify-between gap-3 rounded-md border border-gray-200 p-3'>
      <div className='min-w-0'>
        <p className='truncate text-sm font-medium text-gray-800'>{template.displayTitle}</p>
        <p className='line-clamp-1 text-sm text-gray-500'>{template.bodyText || '—'}</p>
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        <TemplateStatusBadge status={template.status} />
      </div>
    </div>
  )
}
