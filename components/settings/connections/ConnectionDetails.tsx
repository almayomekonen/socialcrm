'use client'

import { useEffect, useState, useTransition } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { Seperator } from '@/lib/Seperator'
import { StatusBadge } from '@/lib/StatusBadge'
import { proToast, toast } from '@/lib/toast'
import { connectionSetup, regenerateSecret } from '@/actions/automations/connections'
import type { SetupGuide } from '@/lib/automations/connectors/types'
import type { ConnectionView, IntegrationView } from '@/lib/automations/connectors/overview'
import SetupGuidePanel, { CopyRow } from './SetupGuidePanel'
import { deliveryIn, errorMessageIn, healthIn, setupGuideIn, timeAgoIn } from './copy'
import { eventTitleIn, localizeIntegration } from '@/lib/automations/catalogI18n'
import { useT } from '@/lib/i18n/I18nProvider'
import SourceRow from './ConnectionSourceRow'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'

/**
 * One connection, in full: its health, the streams inside it, what it unlocks,
 * and how many automations depend on it.
 *
 * Everything is rendered from the view the server assembled. There is no
 * integration name in this file and no branch on one — a connection to a
 * system nobody has written yet renders here correctly on the day its
 * connector is registered.
 */
export default function ConnectionDetails({
  view,
  connection,
  onClose,
  onChanged,
}: {
  view: IntegrationView
  connection: ConnectionView
  onClose: () => void
  onChanged: () => void
}) {
  /** Connection credentials are Pro: provisioning mints a live API key. */
  const expired = useAccessDenied()
  const t = useT()
  const L = t.locale
  const promptConnection = () =>
    proToast({
      title: t('admin.connections.pro.title'),
      body: t('admin.connections.pro.body'),
      source: 'connection_manage',
    })
  const health = healthIn(connection.health, L)
  const delivery = deliveryIn(connection.delivery, L)
  const last = timeAgoIn(connection.lastActivityAt, L)
  const lastEvent = timeAgoIn(connection.lastEventAt, L)

  const [setup, setSetup] = useState<{ guide: SetupGuide | null; webhookUrl: string } | null>(null)
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null)
  const [rotating, startRotate] = useTransition()

  // The webhook address is NOT a secret, and losing access to it when the
  // creation dialog closed was a real dead end. It is retrievable forever.
  useEffect(() => {
    let cancelled = false
    connectionSetup(connection.id).then((res) => {
      if (!cancelled && res.ok) setSetup({ guide: res.guide, webhookUrl: res.webhookUrl })
    })
    return () => {
      cancelled = true
    }
  }, [connection.id])

  function rotate() {
    startRotate(async () => {
      if (expired) return promptConnection()
      const res = await regenerateSecret(connection.id)
      if (res.ok === false) return toast('error', errorMessageIn(res.reason, L))
      setIssuedSecret(res.secret)
      toast('success', t('admin.connections.details.rotated'))
      onChanged()
    })
  }

  return (
    <ModalPop open onClose={onClose} pos='middle' label={connection.displayName} className='w-[520px] max-w-[92vw]' translated>
      {/*
        The dialog is a fixed-height column, not a growing block: ModalPop caps
        itself at 90vh and scrolls the WHOLE box, which scrolled the title out
        of view and clipped long content. Here the header stays put and only the
        body scrolls. `min-h-0` is what lets the body actually shrink inside a
        flex column — without it the content forces the column past its max.
        `dvh` so mobile browser chrome is excluded; the 4rem subtracts
        ModalPop's own p-8.
      */}
      {/* House shape (width + centring on ModalPop, `pt-2` for the close
          button), with one addition this dialog needs: it carries a setup
          guide, a code block, sources and automation impact, so the header is
          pinned and only the body scrolls. 80dvh leaves visible backdrop above
          and below, which is what makes it read as a focused dialog rather
          than a page. */}
      <div className='flex flex-col gap-4 max-h-[80dvh] min-h-0 pt-2'>
        <div className='flex items-start justify-between gap-3 shrink-0'>
          <div className='grid gap-0.5 min-w-0'>
            <h2 className='text-lg font-semibold text-dark truncate leading-tight'>{connection.displayName}</h2>
            <p className='text-sm text-gray-500'>{localizeIntegration(view.integration, L).title}</p>
          </div>
          <span className='flex shrink-0 items-center gap-2'>
            <StatusBadge role={delivery.role} label={delivery.label} size='sm' />
            {connection.health !== 'ok' && <StatusBadge role={health.role} label={health.label} size='sm' />}
          </span>
        </div>

        {delivery.hint && <p className='text-sm text-gray-500 shrink-0'>{delivery.hint}</p>}

        <Seperator className='my-0 shrink-0' />

        {/* The only scrolling region. `min-w-0` lets the code block inside
            shrink instead of widening the dialog. */}
        <div className='flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden grid gap-4 content-start scrollbar-slim'>
          {setup && (
            <>
              <section className='grid gap-3'>
                <h3 className='text-sm font-semibold text-gray-800'>{t('admin.connections.details.setup')}</h3>
                <SetupGuidePanel guide={setupGuideIn(setup.guide, L)} webhookUrl={setup.webhookUrl} />
                {issuedSecret ? (
                  <>
                    <CopyRow label={t('admin.connections.details.newSecret')} value={issuedSecret} copyLabel={t('admin.connections.connect.copy')} copiedLabel={t('admin.connections.connect.copied')} />
                    <p className='text-sm text-amber-700'>
                      {t('admin.connections.details.secretOnce')}
                    </p>
                  </>
                ) : (
                  <div className='flex items-center justify-between gap-3'>
                    <span className='text-sm text-gray-500'>{t('admin.connections.details.secretLost')}</span>
                    <Btn
                      variant='outline'
                      size='small'
                      lbl={rotating ? t('admin.connections.details.rotating') : t('admin.connections.details.rotate')}
                      icon={rotating ? 'spinner' : 'rotate'}
                      iconClassName={rotating ? 'animate-spin' : undefined}
                      disabled={rotating}
                      onClick={rotate}
                    />
                  </div>
                )}
              </section>

              <Seperator className='my-0' />
            </>
          )}

          <section className='grid gap-2'>
            <h3 className='text-sm font-semibold text-gray-800'>{t('admin.connections.details.unlocks')}</h3>
            {view.unlocks.length === 0 ? (
              <p className='text-sm text-gray-500'>{t('admin.connections.details.noUnlocks')}</p>
            ) : (
              <ul className='grid gap-1'>
                {view.unlocks.map((e) => (
                  <li key={e.key} className='text-sm text-gray-600'>
                    {eventTitleIn(e.key, e.title, L)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Seperator className='my-0' />

          <section className='grid gap-2'>
            <h3 className='text-sm font-semibold text-gray-800'>{t('admin.connections.details.sources')}</h3>
            {connection.sources.length === 0 ? (
              <p className='text-sm text-gray-500'>{t('admin.connections.details.noSources')}</p>
            ) : (
              <ul className='grid gap-2'>
                {connection.sources.map((s) => (
                  <SourceRow key={s.id} connectionId={connection.id} source={s} onChanged={onChanged} />
                ))}
              </ul>
            )}
          </section>

          <Seperator className='my-0' />

          <section className='grid gap-2'>
            <h3 className='text-sm font-semibold text-gray-800'>{t('admin.connections.details.automations')}</h3>
            <p className='text-sm text-gray-600'>
              {connection.automations === 0
                ? t('admin.connections.details.noAutomations')
                : t('admin.connections.details.automationsCount', { count: String(connection.automations) })}
            </p>
            {connection.automations > 0 && connection.health !== 'ok' && (
              <p className='text-sm text-red-600' role='alert'>
                {t('admin.connections.details.usedAlert')}
              </p>
            )}
            <p className='text-sm text-gray-500'>
              {lastEvent ? t('admin.connections.details.lastEvent', { ago: lastEvent }) : t('admin.connections.details.noEvent')}
              {connection.eventCount > 0 ? t('admin.connections.details.eventCount', { count: String(connection.eventCount) }) : ''}
            </p>
            <p className='text-sm text-gray-500'>
              {last ? t('admin.connections.details.lastActivity', { ago: last }) : t('admin.connections.details.noActivity')}
            </p>
          </section>
        </div>
      </div>
    </ModalPop>
  )
}
