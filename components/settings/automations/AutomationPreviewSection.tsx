'use client'

import { substituteVariables } from '@/lib/automations/variables'
import type { ActionDefinition } from '@/lib/automations/catalog/types'
import AutomationEmailPreview from './AutomationEmailPreview'
import AutomationMessagePreview from './AutomationMessagePreview'
import type { CtaDraft } from './AutomationContentSection'
import { customerTextAttrs } from '@/lib/i18n/config'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * "כך זה ייראה" — the preview section, driven by the ACTION's declared preview
 * shape. The Builder still names no action; it renders whatever shape the
 * catalog declares.
 *
 * The `email` shape goes through the real renderer (AutomationEmailPreview), so
 * preview and send cannot disagree. The other shapes stay textual because their
 * executors declare no preview to render — an approximation is honest for a task
 * title, and was not for an email.
 *
 * Extracted from AutomationSheet, which had crossed the file-size hard limit
 * (architecture-rules §1).
 */

export default function AutomationPreviewSection({
  action,
  previewName,
  subject,
  body,
  cta,
  templateId,
  templateBindings,
  title,
}: {
  action: ActionDefinition | null
  previewName: string | null
  subject: string
  body: string
  cta: CtaDraft | null
  templateId?: string
  templateBindings?: Record<string, string>
  /** A title-shaped action's authored line — what the `record` shape shows. */
  title?: string
}) {
  /**
   * `record` is the only shape still substituted locally. The `message` shape used
   * to be too — an approximation that could drift from the send, which is exactly
   * the gap that let a bad email signature ship. Both delivering shapes now render
   * through their executor.
   */
  const t = useT()
  const vars = { leadFirstName: previewName, businessName: null, repName: null }
  /**
   * The record shape previews the TITLE the action authors, not the email
   * subject. It read `subject` while the title had nowhere to live — so the
   * preview showed a field the executor never received, and the task it
   * described was created blank.
   */
  const previewRecord = action?.preview === 'record' ? substituteVariables(title ?? '', vars) : ''

  return (
    <section className='grid gap-2'>
      <h3 className='text-sm font-semibold text-gray-800'>{previewName ? t('admin.automationSheet.preview.headingFor', { name: previewName }) : t('admin.automationSheet.preview.heading')}</h3>
      <div className='border rounded-md bg-gray-50 p-4 grid gap-2'>
        {action?.preview === 'email' && (
          <AutomationEmailPreview draft={{ subject, body, ctaLabel: cta?.label ?? null, ctaUrl: cta?.url ?? null }} />
        )}
        {action?.preview === 'message' && (
          <AutomationMessagePreview templateId={templateId ?? ''} bindings={templateBindings ?? {}} />
        )}
        {action?.preview === 'record' && (
          <p className='text-sm text-gray-600' {...(previewRecord ? customerTextAttrs(t.locale) : {})}>
            {previewRecord || t('admin.automationSheet.preview.newRecord')}
          </p>
        )}
        {(!action || action.preview === 'none') && <p className='text-sm text-gray-600'>{t('admin.automationSheet.preview.none')}</p>}
      </div>
    </section>
  )
}
