'use client'

import { useState, useTransition } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { Input, Select } from '@/lib/form'
import { Seperator } from '@/lib/Seperator'
import { toast } from '@/lib/toast'
import { installTemplate } from '@/actions/automations/templates'
import type { TemplateView } from '@/lib/automations/templates/overview'
import RemoteParameters from '@/components/settings/automations/RemoteParameters'
import { creatorFor, type InlineResolver } from './firstPartyCreators'
import InlineCreator from './InlineCreator'
import { errorMessageIn } from './copy'
import { localizeTemplate } from '@/lib/automations/templateI18n'
import { untranslatedAttrs } from '@/lib/i18n/config'
import { useT } from '@/lib/i18n/I18nProvider'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'

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
  const t = useT()
  /** What the dialog SHOWS. Values, keys and the install call read `template` itself. */
  const shown = localizeTemplate(template, t.locale)
  const errorMessage = (reason: string) => errorMessageIn(reason, t.locale)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(template.variables.map((v) => [v.key, v.default ?? ''])),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  /**
   * Steps that must run before installing, keyed by the variable they answer.
   * A creator registers one; everything else installs exactly as before.
   */
  const [resolvers, setResolvers] = useState<Record<string, InlineResolver>>({})

  const missing = template.variables.some(
    (v) => v.validation?.required && !(values[v.key] ?? '').trim() && !resolvers[v.key],
  )

  /**
   * TIER 2. The template gallery and this dialog stay readable, so an expired
   * customer can see exactly what each automation would do for them. Only the
   * install itself is gated: it creates automations that go on to send.
   */
  const proLocked = useAccessDenied()

  function install() {
    setError(null)
    start(async () => {
      /**
       * Resolve first, install second. For a quotation that means the price
       * list is saved through its own domain and its id becomes this variable's
       * value — so `installTemplate` receives an ordinary answer and never
       * learns that anything was created on the way.
       */
      const resolved: Record<string, string> = {}
      for (const [key, resolve] of Object.entries(resolvers)) {
        const out = await resolve()
        if (out.ok === false) return setError(errorMessage(out.reason))
        resolved[key] = out.value
      }

      const res = await installTemplate(template.key, { ...values, ...resolved })
      if (res.ok === false) return setError(errorMessage(res.reason))
      toast('success', res.created === 1 ? t('admin.automationTemplates.install.createdOne') : t('admin.automationTemplates.install.createdMany', { count: String(res.created) }))
      onDone()
    })
  }

  return (
    <ModalPop open onClose={onClose} pos='top' label={shown.title} translated>
      <div className='grid gap-5 w-[min(90vw,560px)] pt-2'>
        <h2 className='text-lg font-semibold text-gray-800'>{shown.title}</h2>
        <p className='text-sm text-gray-600 leading-relaxed'>{shown.description}</p>

        {template.variables.length > 0 && (
          <>
            <Seperator className='my-0' />
            <section className='grid gap-3'>
              <h3 className='text-sm font-semibold text-gray-800'>{t('admin.automationTemplates.install.settings')}</h3>
              {shown.variables.map((variable) =>
                /**
                 * A first-party selection renders through the SAME control the
                 * Builder uses for it, rather than a picker invented here — so
                 * the customer chooses from one list whichever door they came
                 * through. It needs no connection, which is why `connectionId`
                 * is null.
                 */
                variable.type === 'enum_agency' && creatorFor(variable.optionSource) ? (
                  /**
                   * The source can be BUILT here, so the customer never has to
                   * leave to create their first one. Everything else about this
                   * dialog is unchanged.
                   */
                  <InlineCreator
                    key={variable.key}
                    variable={variable}
                    value={values[variable.key] ?? ''}
                    onChange={(v) => setValues({ ...values, [variable.key]: v })}
                    onResolverChange={(r) =>
                      setResolvers((prev) => {
                        const next = { ...prev }
                        if (r) next[variable.key] = r
                        else delete next[variable.key]
                        return next
                      })
                    }
                  />
                ) : variable.type === 'enum_agency' ? (
                  <RemoteParameters
                    key={variable.key}
                    parameters={[variable]}
                    connectionId={null}
                    values={values}
                    onChange={setValues}
                  />
                ) : variable.type === 'enum_static' ? (
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
              {shown.variables.some((v) => v.help) && (
                <p className='text-sm text-gray-500 ms-1'>{shown.variables.find((v) => v.help)!.help}</p>
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
              <h3 className='text-sm font-semibold text-gray-800'>{t('admin.automationTemplates.install.updateHeading')}</h3>
              <p className='text-sm text-gray-600 leading-relaxed'>
                {t('admin.automationTemplates.install.updateBody')}
              </p>
              {view.changes.length > 0 && (
                <ul className='grid gap-1' {...untranslatedAttrs(t.locale)}>
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
            {view.preview.length === 1
              ? t('admin.automationTemplates.install.createsOne')
              : t('admin.automationTemplates.install.createsMany', { count: String(view.preview.length) })}
          </h3>
          {/* What installing STORES — the automations' own names and texts, as they will be saved. */}
          <ul className='grid gap-2' {...untranslatedAttrs(t.locale)}>
            {view.preview.map((p, i) => (
              <li key={i} className='rounded-md border border-gray-100 bg-gray-50 p-3 grid gap-1'>
                <span className='text-sm font-medium text-gray-800'>{p.name}</span>
                {p.summary && <span className='text-sm text-gray-500'>{p.summary}</span>}
              </li>
            ))}
          </ul>
          {/* Drafts, not live sends: the customer reviews and activates each
              one in the Builder, exactly as if they had written it. */}
          <p className='text-sm text-gray-500'>{t('admin.automationTemplates.install.drafts')}</p>
        </section>

        <div className='grid gap-2'>
{proLocked ? (
            <SubscriptionExpiredState mode='inline' source='automation_template_install' feature={t('admin.automationTemplates.expiredFeature')} translated />
          ) : (
            <Btn
            lbl={pending ? t('admin.automationTemplates.install.installing') : t('admin.automationTemplates.install.install')}
            icon={pending ? 'spinner' : 'plus'}
            iconClassName={pending ? 'animate-spin' : undefined}
            disabled={pending || missing}
            className='w-full'
            onClick={install}
          />
          )}
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
