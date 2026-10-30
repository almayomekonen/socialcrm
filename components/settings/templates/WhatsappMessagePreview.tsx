import type { TemplateVariable } from '@/lib/whatsapp/templates/types'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * Live WhatsApp bubble preview — shows the owner exactly what a lead will see, so
 * they never have to reason about Meta's model. Reuses the app's chat wallpaper
 * and the outbound-bubble tokens from `WhatsappConversation` (same design system).
 * Variable tokens are substituted with their sample values.
 */
const WALLPAPER = 'bg-bg bg-[radial-gradient(var(--color-primary-soft)_1px,transparent_1px)] bg-size-[16px_16px]'

function withSamples(bodyText: string, variables: TemplateVariable[]): string {
  let text = bodyText ?? ''
  for (const v of variables) text = text.split(v.token).join(v.sample)
  return text
}

export default function WhatsappMessagePreview({
  bodyText,
  variables,
  translated = false,
}: {
  bodyText: string
  variables: TemplateVariable[]
  /** The empty placeholder follows the interface language (the settings create dialog). Default Hebrew. */
  translated?: boolean
}) {
  const t = useT()
  const preview = withSamples(bodyText, variables).trim()
  return (
    <div className={`rounded-lg p-3 ${WALLPAPER}`} aria-hidden='true'>
      <div className='flex justify-end'>
        <div className='max-w-[85%] rounded-2xl rounded-se-none border border-success-border bg-success-bg px-3 py-1.5'>
          <p className='min-w-0 text-sm leading-normal whitespace-pre-wrap wrap-break-word text-gray-800'>
            {preview || (translated ? t('settings.templates.form.previewEmpty') : 'תצוגה מקדימה של ההודעה')}
          </p>
        </div>
      </div>
    </div>
  )
}
