'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import type { FieldDescriptor, IssuerData } from '@/lib/billing/issuer/fields'
import { validateIssuerValues } from '@/lib/billing/issuer/validation'
import { FieldRenderer } from './IssuerFieldRenderers'
import { useT } from '@/lib/i18n/I18nProvider'
import { translatorFor } from '@/lib/i18n/translators'
import { localizeIssuerError } from './localizedFields'

/**
 * IssuerIdentityForm — registry-driven business-identity form.
 *
 * STRICT RULES (per Phase 1b lock-in):
 *
 *   1. The form takes a list of fields from the caller and renders
 *      them IN ORDER. The caller controls which tiers — this file
 *      does not.
 *
 *   2. There is NO `if (field.key === 'businessType') { ... }` or any
 *      other field-name-specific branching. Every behavioral difference
 *      between fields lives in the registry (`field.inputType`,
 *      `field.options`, `field.validate`, etc.).
 *
 *   3. No hardcoded labels, no hardcoded help text, no hardcoded
 *      placeholders. All text comes from the field descriptor.
 *
 *   4. Validation is delegated to `validateIssuerValues` from the
 *      shared validation module. The form never runs ad-hoc checks.
 *
 *   5. Input-type dispatch lives in IssuerFieldRenderers — adding a
 *      new inputType means adding it to the registry plus one new
 *      case in FieldRenderer. This file orchestrates state + submit.
 */

type FieldValues = Record<string, unknown>

const HEBREW = translatorFor('he')

export default function IssuerIdentityForm({
  fields,
  initialValues,
  onSubmit,
  submitLabel,
  busy = false,
  cancelLabel,
  onCancel,
  translated = false,
}: {
  /** Fields to render. Caller pre-filters by tier. Order = render order. */
  fields: ReadonlyArray<FieldDescriptor>
  /** Initial values keyed by field.key. Missing keys default to empty. */
  initialValues: Partial<IssuerData>
  /** Called with the validated, rendered-only values on submit. */
  onSubmit: (values: FieldValues) => void | Promise<void>
  /** Hebrew label for the primary CTA. Caller chooses (e.g. "שמור והמשך"). */
  submitLabel: string
  /** Disables all inputs + buttons while a parent action is in flight. */
  busy?: boolean
  /** When set, renders a secondary outline button. */
  cancelLabel?: string
  onCancel?: () => void
  /**
   * The caller passes fields and labels already in the interface language
   * (the issue flow's dialog); the form's own hint, default cancel and the
   * validators' messages then follow it too. Default: Hebrew, as the settings
   * screen (`EditAgency`, not translated yet) expects.
   */
  translated?: boolean
}) {
  const ui = useT()
  const t = translated ? ui : HEBREW
  const locale = t.locale
  const [values, setValues] = useState<FieldValues>(() => initializeValues(fields, initialValues))
  const [errors, setErrors] = useState<Record<string, string>>({})

  function setFieldValue(key: string, value: unknown): void {
    setValues((prev) => ({ ...prev, [key]: value }))
    // Clear stale error for this field as the user edits.
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function handleFieldBlur(key: string): void {
    const field = fields.find((f) => f.key === key)
    if (!field) return

    const cleaned = field.sanitize ? field.sanitize(values[key]) : values[key]
    if (cleaned !== values[key]) {
      setValues((prev) => ({ ...prev, [key]: cleaned }))
    }

    const allSanitized: FieldValues = {}
    for (const f of fields) {
      const v = f.key === key ? cleaned : values[f.key]
      allSanitized[f.key] = f.sanitize ? f.sanitize(v) : v
    }

    const result = field.validate(cleaned, allSanitized)
    setErrors((prev) => {
      const next = { ...prev }
      if (result === true) delete next[key]
      else next[key] = result
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return

    // Only validate fields this form actually rendered. Fields outside
    // the rendered set are left untouched server-side.
    const rendered: FieldValues = {}
    for (const field of fields) {
      const raw = values[field.key]
      rendered[field.key] = field.sanitize ? field.sanitize(raw) : raw
    }

    const result = validateIssuerValues(rendered)
    if ('errors' in result) {
      setErrors(result.errors)
      return
    }

    setErrors({})
    await onSubmit(rendered)
  }

  return (
    <form onSubmit={handleSubmit} className='grid gap-5'>
      {fields.map((field) => (
        <FieldRenderer
          key={field.key}
          field={field}
          value={values[field.key]}
          error={localizeIssuerError(errors[field.key], locale)}
          onChange={(v) => setFieldValue(field.key, v)}
          onBlur={() => handleFieldBlur(field.key)}
          disabled={busy}
        />
      ))}

      <p className='text-xs text-gray-500 ms-1'>{t('billing.issuer.formHint')}</p>

      <div className='flex justify-end gap-2 mt-2'>
        {onCancel && (
          <Btn
            variant='outline'
            lbl={cancelLabel ?? t('common.dialog.cancel')}
            onClick={onCancel}
            disabled={busy}
            type='button'
          />
        )}
        <Btn lbl={submitLabel} disabled={busy} type='submit' />
      </div>
    </form>
  )
}

/**
 * Seed the form's `values` state from the issuer prop. Defaults to ''
 * for text-like inputs so React doesn't complain about controlled →
 * uncontrolled flips when the DB value is null. Radio + file default
 * to null (no selection / no file).
 */
function initializeValues(
  fields: ReadonlyArray<FieldDescriptor>,
  initial: Partial<IssuerData>,
): FieldValues {
  const values: FieldValues = {}
  for (const field of fields) {
    const raw = (initial as Record<string, unknown>)[field.key]
    if (field.inputType === 'radio' || field.inputType === 'file') {
      values[field.key] = raw ?? null
    } else {
      values[field.key] = raw ?? ''
    }
  }
  return values
}
