'use client'

import { useState, useTransition } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { Input, Select } from '@/lib/form'
import { Seperator } from '@/lib/Seperator'
import { toast } from '@/lib/toast'
import { installTemplate } from '@/actions/automations/templates'
import type { TemplateView } from '@/lib/automations/templates/overview'
import { errorMessage } from './copy'

/**
 * Preview and install.
 *
 * The variables are rendered from the template's declarations using the same
 * closed parameter types the Builder uses — a template may not invent an input
 * kind any more than an integration may.
 *
 * The preview is deliberately shown BEFORE the button: installing creates real
 * automations that will email real customers, and "one click" must not mean
 * "without looking".
 */
export default function TemplateInstallDialog({
  view,
  onClose,
  onDone,
}: {
  view: TemplateView
  onClose: () => void
  onDone: () => void
}) {
  const { template } = view
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(template.variables.map((v) => [v.key, v.default ?? ''])),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const missing = template.variables.some((v) => v.validation?.required && !(values[v.key] ?? '').trim())

  function install() {
    setError(null)
    start(async () => {
      const res = await installTemplate(template.key, values)
      if (res.ok === false) return setError(errorMessage(res.reason))
      toast('success', res.created === 1 ? 'האוטומציה נוצרה כטיוטה' : `${res.created} אוטומציות נוצרו כטיוטות`)
      onDone()
    })
  }

  return (
    <ModalPop open onClose={onClose} pos='top' label={template.title}>
      <div className='grid gap-5 w-[min(90vw,560px)] pt-2'>
        <h2 className='text-lg font-semibold text-gray-800'>{template.title}</h2>
        <p className='text-sm text-gray-600 leading-relaxed'>{template.description}</p>

        {template.variables.length > 0 && (
          <>
            <Seperator className='my-0' />
            <section className='grid gap-3'>
              <h3 className='text-sm font-semibold text-gray-800'>הגדרות</h3>
              {template.variables.map((variable) =>
                variable.type === 'enum_static' ? (
                  <Select
                    key={variable.key}
                    lbl={variable.label}
                    options={(variable.options ?? []).map((o) => ({ id: o.value, name: o.label }))}
                    value={values[variable.key] ?? ''}
                    onChange={(e) => setValues({ ...values, [variable.key]: e.target.value })}
                  />
                ) : (
                  <Input
                    key={variable.key}
                    lbl={variable.label}
                    value={values[variable.key] ?? ''}
                    maxLength={variable.validation?.maxLength}
                    onChange={(e) => setValues({ ...values, [variable.key]: e.target.value })}
                  />
                ),
              )}
              {template.variables.some((v) => v.help) && (
                <p className='text-sm text-gray-500 ms-1'>{template.variables.find((v) => v.help)!.help}</p>
              )}
            </section>
          </>
        )}

        {/*
          Shown here rather than on the card because it only matters at the
          moment of installing, and because the reassurance belongs next to
          the button: a new version is an OFFER, never something applied to
          automations the customer already owns.
        */}
        {view.updateAvailable && (
          <>
            <Seperator className='my-0' />
            <section className='grid gap-2'>
              <h3 className='text-sm font-semibold text-gray-800'>קיימת גרסה חדשה</h3>
              <p className='text-sm text-gray-600 leading-relaxed'>
                האוטומציות שכבר התקנתם לא ישתנו — התקנה תיצור עותק חדש לצידן.
              </p>
              {view.changes.length > 0 && (
                <ul className='grid gap-1'>
                  {view.changes.map((c) => (
                    <li key={c.version} className='text-sm text-gray-500'>
                      {c.note}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        <Seperator className='my-0' />

        <section className='grid gap-2'>
          <h3 className='text-sm font-semibold text-gray-800'>
            {view.preview.length === 1 ? 'מה ייווצר' : `מה ייווצר — ${view.preview.length} אוטומציות`}
          </h3>
          <ul className='grid gap-2'>
            {view.preview.map((p, i) => (
              <li key={i} className='rounded-md border border-gray-100 bg-gray-50 p-3 grid gap-1'>
                <span className='text-sm font-medium text-gray-800'>{p.name}</span>
                {p.summary && <span className='text-sm text-gray-500'>{p.summary}</span>}
              </li>
            ))}
          </ul>
          {/* Drafts, not live sends: the customer reviews and activates each
              one in the Builder, exactly as if they had written it. */}
          <p className='text-sm text-gray-500'>האוטומציות ייווצרו כטיוטות. אפשר לערוך ולהפעיל אותן במסך האוטומציות.</p>
        </section>

        <div className='grid gap-2'>
          <Btn
            lbl={pending ? 'מתקין…' : 'התקנה'}
            icon={pending ? 'spinner' : 'plus'}
            iconClassName={pending ? 'animate-spin' : undefined}
            disabled={pending || missing}
            className='w-full'
            onClick={install}
          />
          {error && (
            <p className='text-sm text-red-600 ms-1' role='alert'>
              {error}
            </p>
          )}
        </div>
      </div>
    </ModalPop>
  )
}
