import type { Template } from '@/lib/whatsapp/templates/types'
import TemplateStatusBadge from '@/components/settings/templates/TemplateStatusBadge'
import TemplateRejectionNotice from '@/components/settings/templates/TemplateRejectionNotice'
import TemplatePendingNotice from '@/components/settings/templates/TemplatePendingNotice'
import WhatsappMessagePreview from '@/components/settings/templates/WhatsappMessagePreview'
import BottomSheet from '@/components/mobile/BottomSheet'
import { readyMessageTitle } from './readyMessageTitle'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'
import { variableLabel } from '@/components/settings/templates/templateCopy'

/** The purpose line, by stored category CODE. */
const PURPOSE_LABEL: Record<string, MessageKey> = {
  UTILITY: 'settings.mobile.ready.purpose.UTILITY',
  MARKETING: 'settings.mobile.ready.purpose.MARKETING',
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
  const tr = useT()
  const open = !!template
  const t = template

  return (
    <BottomSheet open={open} onClose={onClose} title={t ? readyMessageTitle(t.displayTitle, tr.locale) : tr('settings.mobile.ready.fallbackTitle')} titleId='ready-message-detail' translated>
      {t && (
        <div className='flex flex-col gap-4'>
          <div className='flex flex-wrap items-center gap-2'>
            <TemplateStatusBadge status={t.status} />
            {t.category && (
              <span className='text-sm text-gray-500'>{PURPOSE_LABEL[t.category] ? tr(PURPOSE_LABEL[t.category]) : t.category}</span>
            )}
          </div>

          {t.status === 'rejected' && t.failureText && <TemplateRejectionNotice failureText={t.failureText} />}
          {t.status === 'pending' && <TemplatePendingNotice />}

          <div>
            <p className='mb-1.5 text-sm text-gray-500'>{tr('settings.templates.form.previewLabel')}</p>
            <WhatsappMessagePreview bodyText={t.bodyText} variables={t.variables} translated />
          </div>

          {t.variables.length > 0 && (
            <p className='text-sm text-gray-500'>{tr('settings.mobile.ready.details', { tokens: t.variables.map((v) => variableLabel(v.token, tr)).join(' · ') })}</p>
          )}

          <div className='flex flex-col gap-2'>
            {onEdit && (
              <button
                type='button'
                className='press flex min-h-11 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                onClick={() => onEdit(t)}
              >
                {tr('settings.templates.row.edit')}
              </button>
            )}
            {onRetry && (
              <button
                type='button'
                className='press flex min-h-11 w-full items-center justify-center rounded-md bg-solid font-medium text-white hover:bg-solid/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                onClick={() => onRetry(t)}
              >
                {tr('settings.templates.row.retry')}
              </button>
            )}
            {onArchive && (
              <button
                type='button'
                className='press flex min-h-11 w-full items-center justify-center rounded-md border border-gray-200 bg-white font-medium text-ink hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                onClick={() => onArchive(t)}
              >
                {tr('settings.mobile.ready.archive')}
              </button>
            )}
            {onDiscard && (
              <button
                type='button'
                className='press flex min-h-11 w-full items-center justify-center rounded-md border border-red-200 bg-white font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                onClick={() => onDiscard(t)}
              >
                {tr('settings.mobile.ready.discard')}
              </button>
            )}
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
