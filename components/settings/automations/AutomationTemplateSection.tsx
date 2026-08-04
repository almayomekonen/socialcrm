'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import { listTemplateSlots } from '@/actions/automations/previewMessage'
import type { TemplateSlot } from '@/lib/automations/whatsapp/templateParams'
import type { ParameterDefinition } from '@/lib/automations/catalog/types'
import type { ConnectionOption } from '@/lib/automations/catalog/types'
import { listOptionsForCapabilityAction } from '@/actions/automations/connections'

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

/** The subject fields a slot may be filled from, with the labels the customer knows. */
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
  const [templates, setTemplates] = useState<ConnectionOption[]>([])
  const [slots, setSlots] = useState<TemplateSlot[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

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
        setProblem('לא ניתן לטעון את ההודעה שנבחרה.')
        return
      }
      setSlots(res.slots)
      // A template can lose its approval at Meta after it was chosen. Saying so
      // here is the difference between a visible problem and an automation that
      // silently never fires.
      setProblem(res.approved ? null : 'ההודעה הזו אינה מאושרת כרגע ולא ניתן לשלוח אותה.')
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

      {!capability && <p className='text-sm text-gray-500 ms-1'>הפעולה הזו אינה זמינה כרגע.</p>}

      {capability && (
        <>
          <Select
            lbl={parameter?.label ?? 'ההודעה המוכנה'}
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
            placeholder={templates.length === 0 ? 'אין הודעות מאושרות' : undefined}
          />

          {parameter?.help && <p className='text-sm text-gray-500 ms-1'>{parameter.help}</p>}

          {templates.length === 0 && (
            <div className='border border-amber-200 rounded-md bg-amber-50 p-3 grid gap-2' role='alert'>
              <p className='text-sm text-amber-800'>
                כדי לשלוח הודעת וואטסאפ באוטומציה צריך הודעה מוכנה שאושרה. אפשר ליצור אותה בהודעות המוכנות.
              </p>
              <Btn variant='outline' size='small' lbl='מעבר להודעות המוכנות' href='/settings/templates' />
            </div>
          )}

          {problem && (
            <p className='text-sm text-amber-700 ms-1' role='alert'>
              {problem}
            </p>
          )}

          {needsMapping.length > 0 && (
            <div className='grid gap-3 rounded-md border border-gray-200 p-3'>
              <div className='grid gap-1'>
                <h4 className='text-sm font-semibold text-gray-800'>מה ימלא את הפרטים בהודעה</h4>
                <p className='text-sm text-gray-500'>ההודעה הזו סונכרנה מוואטסאפ. צריך להגיד מה נכנס בכל מקום.</p>
              </div>
              {needsMapping.map((slot) => (
                <Select
                  key={slot.position}
                  lbl={`מקום ${slot.position}`}
                  options={FIELD_OPTIONS}
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
              הפרטים בהודעה יתמלאו אוטומטית: {slots.map((s) => s.label).join(', ')}
            </p>
          )}
        </>
      )}
    </section>
  )
}
