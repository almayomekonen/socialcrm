'use client'

import { useState, useTransition } from 'react'
import Icon, { type IconNames } from '@/lib/Icon'
import { Btn } from '@/lib/btns/Btn'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import { StatusBadge } from '@/lib/StatusBadge'
import { toast } from '@/lib/toast'
import { revokeConnection } from '@/actions/automations/connections'
import type { ConnectionView, IntegrationView } from '@/lib/automations/connectors/overview'
import ConnectAction from './ConnectAction'
import ConnectionDetails from './ConnectionDetails'
import { DELIVERY, HEALTH, STRATEGY, timeAgo } from './copy'

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
  const [details, setDetails] = useState<ConnectionView | null>(null)
  const [confirm, setConfirm] = useState<ConnectionView | null>(null)
  const [pending, start] = useTransition()

  const { integration, connections, connected, needsAttention } = view
  const strategy = STRATEGY[integration.auth]

  function disconnect(connection: ConnectionView) {
    start(async () => {
      const res = await revokeConnection(connection.id)
      setConfirm(null)
      if (!res.ok) return toast('error', 'הניתוק נכשל. נסו שוב.')
      toast('success', 'החיבור נותק')
      onChanged()
    })
  }

  return (
    <div className='rounded-lg border border-gray-200 bg-white p-6 grid gap-4 content-start'>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex items-center gap-2.5 min-w-0'>
          <Icon name={integration.icon as IconNames} className='size-7 bg-gray-900 shrink-0' />
          <h2 className='text-lg font-bold text-dark truncate'>{integration.title}</h2>
        </div>
        {connected && <StatusBadge role='success' label='מחובר' size='sm' />}
        {needsAttention && <StatusBadge role='error' label='דורש טיפול' size='sm' />}
      </div>

      {/* The description IS the catalog: what connecting this actually buys. */}
      <p className='text-sm text-gray-600 leading-relaxed'>
        {view.unlocks.length > 0 ? `מאפשר אוטומציות על: ${view.unlocks.map((e) => e.title).join(' · ')}` : strategy.how}
      </p>

      {connections.length === 0 && (
        <div className='flex items-center justify-between gap-3'>
          <span className='text-sm text-gray-400'>{strategy.needsConnection ? 'לא מחובר' : 'לא נדרש חיבור'}</span>
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
            const health = HEALTH[c.health]
            const delivery = DELIVERY[c.delivery]
            const last = timeAgo(c.lastActivityAt)
            const lastEvent = timeAgo(c.lastEventAt)
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

                <p className='text-sm text-gray-500'>
                  {c.sources.length === 1 ? 'מקור אחד' : `${c.sources.length} מקורות`}
                  {' · '}
                  {c.automations === 1 ? 'אוטומציה אחת' : `${c.automations} אוטומציות`}
                  {lastEvent ? ` · אירוע אחרון ${lastEvent}` : ''}
                  {last ? ` · פעילות אחרונה ${last}` : ''}
                </p>

                {c.automations > 0 && c.health !== 'ok' && (
                  <p className='text-sm text-red-600' role='alert'>
                    האוטומציות שמשתמשות בחיבור הזה מסומנות כדורשות טיפול.
                  </p>
                )}

                <div className='flex flex-wrap items-center gap-2'>
                  <Btn variant='ghost' size='small' lbl='פרטים' icon='eye' onClick={() => setDetails(c)} />
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
                      lbl='ניתוק'
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
            ? `ניתוק "${confirm.displayName}" יסמן ${confirm.automations} אוטומציות כדורשות טיפול, והן יפסיקו לפעול עד לחיבור מחדש.`
            : `ניתוק "${confirm?.displayName ?? ''}" יבטל את האירועים שהחיבור הזה מאפשר.`
        }
        confirmLbl='ניתוק'
        destructive
      />
    </div>
  )
}
