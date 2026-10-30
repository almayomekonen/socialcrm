'use client'

import { type RefObject } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import { variableTokenFor } from '@/lib/automations/variables'
import { fieldLabelIn } from '@/lib/automations/catalogI18n'
import { useT } from '@/lib/i18n/I18nProvider'
import type { ParameterDefinition } from '@/lib/automations/catalog/types'

/**
 * What the customer configures for an action whose content is ONE line: the
 * line itself.
 *
 * The third configuration shape beside `AutomationContentSection` (an email) and
 * `AutomationTemplateSection` (a chosen message). Which one renders is decided
 * by the ACTION'S OWN declared parameters, so this component names no action —
 * it is the shape, not the task.
 *
 * There is no body, no subject and no CTA here, and that is the product model
 * rather than a shortcut: a task is read by the rep off their own worklist.
 * Offering an email body would be offering something nothing will ever render.
 *
 * The label and the length bound come from the catalog declaration, so what the
 * Builder shows and what the server enforces cannot drift.
 */

/**
 * The subject fields a title may reference.
 *
 * A client-safe constant for the same reason `AutomationTemplateSection`'s field
 * list is one: the authority is the executor's `resolvableFields`, and the
 * executor registry reaches transports and tables, so a Client Component cannot
 * import it. CI pins this against `taskExecutor.resolvableFields`
 * (__tests__/automations/executors.test.ts, the `variable authority` block), so
 * a drift fails the build rather than shipping a chip that renders as a raw
 * token on a real task.
 *
 * Only the FIELDS are named here — the Hebrew token for each comes from the one
 * vocabulary, so a chip cannot spell a token differently from the substituter.
 */
export const TITLE_VARIABLE_FIELDS = ['leadFirstName'] as const

const TITLE_CHIPS = TITLE_VARIABLE_FIELDS.map((field) => ({ field, token: variableTokenFor(field) ?? field }))

export default function AutomationTitleSection({
  title,
  parameter,
  value,
  inputRef,
  onChange,
  onInsertToken,
}: {
  /** The action's own title, used as the section heading. */
  title: string
  /** The catalog's `title` parameter — its label and bound come from there. */
  parameter: ParameterDefinition | null
  value: string
  inputRef: RefObject<(HTMLInputElement & HTMLTextAreaElement) | null>
  onChange: (next: string) => void
  onInsertToken: (token: string) => void
}) {
  const t = useT()
  return (
    <section className='grid gap-3'>
      <h3 className='text-sm font-semibold text-gray-800'>{title}</h3>

      <Input
        ref={inputRef}
        lbl={parameter?.label ?? t('admin.automationSheet.content.titleFallback')}
        info={parameter?.help}
        value={value}
        maxLength={parameter?.validation?.maxLength}
        onChange={(e) => onChange(e.target.value)}
      />

      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-sm text-gray-500'>{t('admin.automationSheet.content.insert')}</span>
        {TITLE_CHIPS.map((v) => (
          <Btn key={v.field} variant='outline' size='small' lbl={fieldLabelIn(v.field, v.token, t.locale)} onClick={() => onInsertToken(v.token)} />
        ))}
      </div>
    </section>
  )
}
