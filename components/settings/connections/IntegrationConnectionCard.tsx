'use client'

import { useState, useTransition } from 'react'
import Icon, { type IconNames } from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { StatusBadge } from '@/lib/StatusBadge'
import { proToast, toast } from '@/lib/toast'
import { revokeConnection } from '@/actions/automations/connections'
import { intakeErrorCopy } from '@/lib/automations/connectors/intakeErrors'
import type { ConnectionView, IntegrationView } from '@/lib/automations/connectors/overview'
import ConnectAction from './ConnectAction'
import ConnectionDetails from './ConnectionDetails'
import { deliveryIn, healthIn, strategyIn, timeAgoIn } from './copy'
import { eventTitleIn, localizeIntegration } from '@/lib/automations/catalogI18n'
import { useT } from '@/lib/i18n/I18nProvider'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'

/**
 * ONE card, for every integration that will ever exist.
 *
 * It renders `icon`, `title`, a description DERIVED from the events the
 * integration unlocks, each connection's health, its source count, its
 * automation count, its last activity, and a connect/reconnect/disconnect
 * action chosen by the auth strategy alone.
 *
 * There is no integration name in this file, no switch on one, and no lookup
 * table keyed by one. Registering a connector is what makes a card appear.
 *
 * Visual pattern deliberately matches the shipped integrations directory card
 * (`components/settings/integrations/IntegrationCard.tsx`) — same container,
 * same header shape, same ConfirmPop on disconnect — so the two surfaces read
 * as one product.
 */
export default function IntegrationConnectionCard({ view, onChanged }: { view: IntegrationView; onChanged: () => void }) {
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
  const [details, setDetails] = useState<ConnectionView | null>(null)
  const [confirm, setConfirm] = useState<ConnectionView | null>(null)
  const [pending, start] = useTransition()

  const { connections, connected, needsAttention } = view
  /** Shown words only; the connect flow and the routing read `view.integration` itself. */
  const integration = localizeIntegration(view.integration, L)
  const strategy = strategyIn(integration.auth, L)

  function disconnect(connection: ConnectionView) {
    start(async () => {
      if (expired) return promptConnection()
      const res = await revokeConnection(connection.id)
      setConfirm(null)
      if (!res.ok) return toast('error', t('admin.connections.card.disconnectFailed'))
      toast('success', t('admin.connections.card.disconnected'))
      onChanged()
    })
  }

  return (
    <div className='rounded-lg border border-gray-200 bg-white p-6 grid gap-4 content-start'>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex items-center gap-2.5 min-w-0'>
          <Icon name={integration.icon as IconNames} className='size-7 bg-gray-900 shrink-0' />
          {/* h3: the page owns h1 and its section heading owns the h2 above this card. */}
          <h3 className='text-lg font-bold text-dark truncate'>{integration.title}</h3>
        </div>
        {connected && <StatusBadge role='success' label={t('admin.connections.card.connected')} size='sm' />}
        {needsAttention && <StatusBadge role='error' label={t('admin.connections.card.needsAttention')} size='sm' />}
      </div>

      {/* The description IS the catalog: what connecting this actually buys. */}
      <p className='text-sm text-gray-600 leading-relaxed'>
        {view.unlocks.length > 0
          ? t('admin.connections.card.unlocks', { events: view.unlocks.map((e) => eventTitleIn(e.key, e.title, L)).join(' · ') })
          : strategy.how}
      </p>

      {connections.length === 0 && (
        <div className='flex items-center justify-between gap-3'>
          <span className='text-sm text-gray-400'>{strategy.needsConnection ? t('admin.connections.card.notConnected') : t('admin.connections.card.noConnectionNeeded')}</span>
          <ConnectAction
            integrationKey={integration.key}
            integrationTitle={integration.title}
            auth={integration.auth}
            connected={false}
            onDone={onChanged}
          />
        </div>
      )}

      {connections.length > 0 && (
        <ul className='grid gap-3'>
          {connections.map((c) => {
            const health = healthIn(c.health, L)
            const delivery = deliveryIn(c.delivery, L)
            const last = timeAgoIn(c.lastActivityAt, L)
            const lastEvent = timeAgoIn(c.lastEventAt, L)
            return (
              <li key={c.id} className='grid gap-2 rounded-md border border-gray-100 bg-gray-50 p-3'>
                <div className='flex items-center justify-between gap-3'>
                  <span className='min-w-0 truncate text-sm font-medium text-gray-800'>{c.displayName}</span>
                  <span className='flex shrink-0 items-center gap-2'>
                    {/* Delivery answers "is anything getting through?"; health
                        answers "is the authorisation still good?" Both, because
                        a connection can be perfectly authorised and silent. */}
                    <StatusBadge role={delivery.role} label={delivery.label} size='xs' />
                    {c.health !== 'ok' && <StatusBadge role={health.role} label={health.label} size='xs' />}
                  </span>
                </div>

                {delivery.hint && <p className='text-sm text-gray-500'>{delivery.hint}</p>}

                {/*
                  What actually happened, in the customer's terms. The technical
                  reason is mapped, never printed: `lastRejectionReason` holds
                  `invalid_signature` and this renders the sentence for it.
                */}
                {c.delivery === 'rejected' &&
                  (() => {
                    const copy = intakeErrorCopy(c.lastRejectionReason, L)
                    if (!copy) return null
                    return (
                      <div className='grid gap-2 rounded-md border border-red-200 bg-red-50 p-3' role='alert'>
                        <p className='text-sm font-semibold text-red-900'>{copy.title}</p>
                        <p className='text-sm text-red-800'>{copy.explanation}</p>
                        {copy.action && (
                          <span>
                            <Btn variant='outline' size='small' lbl={copy.action.label} href={copy.action.href} />
                          </span>
                        )}
                      </div>
                    )
                  })()}

                <p className='text-sm text-gray-500'>
                  {c.sources.length === 1 ? t('admin.connections.card.sourcesOne') : t('admin.connections.card.sourcesMany', { count: String(c.sources.length) })}
                  {' · '}
                  {c.automations === 1 ? t('admin.connections.card.automationsOne') : t('admin.connections.card.automationsMany', { count: String(c.automations) })}
                  {lastEvent ? t('admin.connections.card.lastEvent', { ago: lastEvent }) : ''}
                  {last ? t('admin.connections.card.lastActivity', { ago: last }) : ''}
                </p>

                {c.automations > 0 && c.health !== 'ok' && (
                  <p className='text-sm text-red-600' role='alert'>
                    {t('admin.connections.card.usedAlert')}
                  </p>
                )}

                <div className='flex flex-wrap items-center gap-2'>
                  <Btn variant='ghost' size='small' lbl={t('admin.connections.card.details')} icon='eye' onClick={() => setDetails(c)} />
                  <ConnectAction
                    integrationKey={integration.key}
                    integrationTitle={integration.title}
                    auth={integration.auth}
                    connected={c.health === 'ok'}
                    onDone={onChanged}
                  />
                  {c.health !== 'revoked' && (
                    <Btn
                      variant='ghost'
                      size='small'
                      lbl={t('admin.connections.card.disconnect')}
                      icon='link-slash'
                      disabled={pending}
                      onClick={() => setConfirm(c)}
                    />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {details && <ConnectionDetails view={view} connection={details} onClose={() => setDetails(null)} onChanged={onChanged} />}

      <ConfirmPop
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && disconnect(confirm)}
        msg={
          confirm && confirm.automations > 0
            ? t('admin.connections.card.confirmUsed', { name: confirm.displayName, count: String(confirm.automations) })
            : t('admin.connections.card.confirm', { name: confirm?.displayName ?? '' })
        }
        confirmLbl={t('admin.connections.card.disconnect')}
        destructive
        translated
      />
    </div>
  )
}
