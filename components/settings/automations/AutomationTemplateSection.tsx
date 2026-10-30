'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import { listTemplateSlots } from '@/actions/automations/previewMessage'
import type { TemplateSlot } from '@/lib/automations/whatsapp/templateParams'
import type { ParameterDefinition } from '@/lib/automations/catalog/types'
import type { ConnectionOption } from '@/lib/automations/catalog/types'
import { listOptionsForCapabilityAction } from '@/actions/automations/connections'
import { fieldLabelIn } from '@/lib/automations/catalogI18n'
import { useT } from '@/lib/i18n/I18nProvider'

/**
 * What the customer configures for a WhatsApp automation: WHICH approved message,
 * and WHAT fills its blanks.
 *
 * There is no message body to write here, and that is the product model rather
 * than a shortcut. WhatsApp only allows a business to open a conversation with a
 * message Meta approved in advance, so the automation's content is chosen, not
 * typed. Offering a text box would be offering something that cannot be sent.
 *
 * The two states this renders are the two the template model actually has:
 *   · a message created in SocialCRM already says what its blanks mean, so there
 *     is nothing to map and nothing is asked;
 *   · a message synced from Meta has bare numbered blanks whose meaning we do not
 *     know — so the customer says, and until they do the automation cannot save.
 */

/** The subject fields a slot may be filled from, with the labels the customer knows (worded by field key: `fieldLabelIn`). */
const FIELD_OPTIONS = [
  { id: 'leadFirstName', name: 'שם הליד' },
  { id: 'businessName', name: 'שם העסק' },
  { id: 'repName', name: 'שם הנציג' },
  { id: 'meetingTitle', name: 'שם הפגישה' },
  { id: 'meetingWhen', name: 'מועד הפגישה' },
  { id: 'meetingDetails', name: 'פרטי הפגישה' },
]

export default function AutomationTemplateSection({
  title,
  parameter,
  capability,
  templateId,
  bindings,
  onTemplateChange,
  onBindingsChange,
}: {
  title: string
  /** The catalog's `templateId` parameter — its label and help come from there. */
  parameter: ParameterDefinition | null
  /**
   * The capability the ACTION declares it needs. The options live on whichever
   * connection grants it — which may not be the connection the EVENT is bound to,
   * and which this component deliberately cannot identify.
   */
  capability: string | null
  templateId: string
  bindings: Record<string, string>
  onTemplateChange: (next: string) => void
  onBindingsChange: (next: Record<string, string>) => void
}) {
  const t = useT()
  const fieldOptions = FIELD_OPTIONS.map((o) => ({ id: o.id, name: fieldLabelIn(o.id, o.name, t.locale) }))
  const [templates, setTemplates] = useState<ConnectionOption[]>([])
  const [slots, setSlots] = useState<TemplateSlot[] | null>(null)
  const [problem, setProblem] = useState<'load' | 'notApproved' | null>(null)

  // The approved ready-made messages, from the connector's generic option
  // provider — the same path the form picker uses, addressed by capability.
  useEffect(() => {
    if (!capability) return
    let cancelled = false
    ;(async () => {
      const res = await listOptionsForCapabilityAction(capability, parameter?.optionSource ?? '')
      if (!cancelled) setTemplates(res.ok ? res.options : [])
    })()
    return () => {
      cancelled = true
    }
  }, [capability, parameter?.optionSource])

  // What the chosen message needs filled in.
  useEffect(() => {
    if (!templateId) {
      setSlots(null)
      setProblem(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const res = await listTemplateSlots(templateId)
      if (cancelled) return
      if (res.ok === false) {
        setSlots(null)
        setProblem('load')
        return
      }
      setSlots(res.slots)
      // A template can lose its approval at Meta after it was chosen. Saying so
      // here is the difference between a visible problem and an automation that
      // silently never fires.
      setProblem(res.approved ? null : 'notApproved')
    })()
    return () => {
      cancelled = true
    }
  }, [templateId])

  /** Slots the customer must answer — the ones the template does not explain itself. */
  const needsMapping = (slots ?? []).filter((s) => !s.field)

  return (
    <section className='grid gap-3'>
      <h3 className='text-sm font-semibold text-gray-800'>{title}</h3>

      {!capability && <p className='text-sm text-gray-500 ms-1'>{t('admin.automationSheet.message.unavailable')}</p>}

      {capability && (
        <>
          <Select
            lbl={parameter?.label ?? t('admin.automationSheet.message.fallbackLabel')}
            options={templates.map((t) => ({ id: t.id, name: t.label }))}
            value={templateId}
            onChange={(e) => {
              onTemplateChange(e.target.value)
              // The new template's slots are its own; carrying the previous
              // mapping over would bind position 1 to whatever the old message
              // happened to mean there.
              onBindingsChange({})
            }}
            required
            placeholder={templates.length === 0 ? t('admin.automationSheet.message.noApproved') : undefined}
          />

          {parameter?.help && <p className='text-sm text-gray-500 ms-1'>{parameter.help}</p>}

          {templates.length === 0 && (
            <div className='border border-amber-200 rounded-md bg-amber-50 p-3 grid gap-2' role='alert'>
              <p className='text-sm text-amber-800'>
                {t('admin.automationSheet.message.needApproved')}
              </p>
              <Btn
                variant='outline'
                size='small'
                lbl={t('admin.automationSheet.message.goToReady')}
                href='/settings/integrations?section=templates'
              />
            </div>
          )}

          {problem && (
            <p className='text-sm text-amber-700 ms-1' role='alert'>
              {problem === 'load' ? t('admin.automationSheet.message.loadFailed') : t('admin.automationSheet.message.notApproved')}
            </p>
          )}

          {needsMapping.length > 0 && (
            <div className='grid gap-3 rounded-md border border-gray-200 p-3'>
              <div className='grid gap-1'>
                <h4 className='text-sm font-semibold text-gray-800'>{t('admin.automationSheet.message.mapHeading')}</h4>
                <p className='text-sm text-gray-500'>{t('admin.automationSheet.message.mapBody')}</p>
              </div>
              {needsMapping.map((slot) => (
                <Select
                  key={slot.position}
                  lbl={t('admin.automationSheet.message.slot', { position: String(slot.position) })}
                  options={fieldOptions}
                  value={bindings[String(slot.position)] ?? ''}
                  onChange={(e) => onBindingsChange({ ...bindings, [String(slot.position)]: e.target.value })}
                  required
                />
              ))}
            </div>
          )}

          {slots !== null && needsMapping.length === 0 && slots.length > 0 && (
            // Stated rather than silent: the customer should know the blanks are
            // handled, not wonder whether they were missed.
            <p className='text-sm text-gray-500 ms-1'>
              {t('admin.automationSheet.message.autoFilled', {
                fields: slots.map((s) => (s.field ? fieldLabelIn(s.field, s.label, t.locale) : s.label)).join(', '),
              })}
            </p>
          )}
        </>
      )}
    </section>
  )
}
