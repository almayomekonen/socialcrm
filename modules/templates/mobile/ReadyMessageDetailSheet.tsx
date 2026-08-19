import type { Template } from '@/lib/whatsapp/templates/types'
import TemplateStatusBadge from '@/components/settings/templates/TemplateStatusBadge'
import TemplateRejectionNotice from '@/components/settings/templates/TemplateRejectionNotice'
import TemplatePendingNotice from '@/components/settings/templates/TemplatePendingNotice'
import WhatsappMessagePreview from '@/components/settings/templates/WhatsappMessagePreview'
import BottomSheet from '@/components/mobile/BottomSheet'
import { readyMessageTitle } from './readyMessageTitle'

const PURPOSE_LABEL: Record<string, string> = {
  UTILITY: 'עדכון או תזכורת',
  MARKETING: 'מבצע או הצעה',
}

/**
 * Preview + actions for one ready message. Actions are full-width 44px buttons
 * — never tiny icons in a table row.
 */
export default function ReadyMessageDetailSheet({
  template,
  onClose,
  onEdit,
  onRetry,
  onArchive,
  onDiscard,
}: {
  template: Template | null
  onClose: () => void
  onEdit?: (template: Template) => void
  onRetry?: (template: Template) => void
  onArchive?: (template: Template) => void
  onDiscard?: (template: Template) => void
}) {
  const open = !!template
  const t = template

  return (
    <BottomSheet open={open} onClose={onClose} title={t ? readyMessageTitle(t.displayTitle) : 'הודעה מוכנה'} titleId='ready-message-detail'>
      {t && (
        <div className='flex flex-col gap-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <TemplateStatusBadge status={t.status} />
            {t.category && (
              <span className='text-sm text-gray-500'>{PURPOSE_LABEL[t.category] ?? t.category}</span>
            )}
          </div>

          {t.status === 'rejected' && t.failureText && <TemplateRejectionNotice failureText={t.failureText} />}
          {t.status === 'pending' && <TemplatePendingNotice />}

          <div>
            <p className='mb-1.5 text-sm text-gray-500'>כך הליד יראה את ההודעה</p>
            <WhatsappMessagePreview bodyText={t.bodyText} variables={t.variables} />
          </div>

          {t.variables.length > 0 && (
            <p className='text-sm text-gray-500'>פרטים בהודעה: {t.variables.map((v) => v.token).join(' · ')}</p>
          )}

          <div className='flex flex-col gap-2'>
            {onEdit && (
              <button
                type='button'
                className='press flex min-h-11 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                onClick={() => onEdit(t)}
              >
                עריכת הודעה
              </button>
            )}
            {onRetry && (
              <button
                type='button'
                className='press flex min-h-11 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                onClick={() => onRetry(t)}
              >
                ערוך ונסה שוב
              </button>
            )}
            {onArchive && (
              <button
                type='button'
                className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                onClick={() => onArchive(t)}
              >
                העבר לארכיון
              </button>
            )}
            {onDiscard && (
              <button
                type='button'
                className='press flex min-h-11 w-full items-center justify-center rounded-md border border-red-200 bg-white font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                onClick={() => onDiscard(t)}
              >
                מחק הודעה
              </button>
            )}
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
