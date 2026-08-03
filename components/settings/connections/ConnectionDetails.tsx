'use client'

import ModalPop from '@/lib/modals/ModalPop'
import { Seperator } from '@/lib/Seperator'
import { StatusBadge } from '@/lib/StatusBadge'
import type { ConnectionView, IntegrationView } from '@/lib/automations/connectors/overview'
import { HEALTH, SUBSCRIPTION, timeAgo } from './copy'

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
}: {
  view: IntegrationView
  connection: ConnectionView
  onClose: () => void
}) {
  const health = HEALTH[connection.health]
  const last = timeAgo(connection.lastActivityAt)

  return (
    <ModalPop open onClose={onClose} pos='top' label={connection.displayName}>
      <div className='grid gap-5 w-[min(90vw,560px)] pt-2'>
        <div className='flex items-start justify-between gap-3'>
          <div className='grid gap-1 min-w-0'>
            <h2 className='text-lg font-semibold text-gray-800 truncate'>{connection.displayName}</h2>
            <p className='text-sm text-gray-500'>{view.integration.title}</p>
          </div>
          <StatusBadge role={health.role} label={health.label} size='sm' />
        </div>

        <Seperator className='my-0' />

        <section className='grid gap-2'>
          <h3 className='text-sm font-semibold text-gray-800'>מה החיבור הזה מאפשר</h3>
          {view.unlocks.length === 0 ? (
            <p className='text-sm text-gray-500'>עדיין אין אירועים שמשתמשים בחיבור הזה.</p>
          ) : (
            <ul className='grid gap-1'>
              {view.unlocks.map((e) => (
                <li key={e.key} className='text-sm text-gray-600'>
                  {e.title}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Seperator className='my-0' />

        <section className='grid gap-2'>
          <h3 className='text-sm font-semibold text-gray-800'>מקורות</h3>
          {connection.sources.length === 0 ? (
            <p className='text-sm text-gray-500'>
              עדיין לא זוהו מקורות. הם יופיעו כאן אחרי הפעילות הראשונה.
            </p>
          ) : (
            <ul className='grid gap-2'>
              {connection.sources.map((s) => {
                const sub = SUBSCRIPTION[s.subscription]
                const srcHealth = HEALTH[s.health]
                return (
                  <li key={s.id} className='flex items-center justify-between gap-3'>
                    <span className='min-w-0 truncate text-sm text-gray-700'>{s.label}</span>
                    <span className='flex shrink-0 items-center gap-2'>
                      <StatusBadge role={sub.role} label={sub.label} size='xs' />
                      {s.health !== 'ok' && <StatusBadge role={srcHealth.role} label={srcHealth.label} size='xs' />}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <Seperator className='my-0' />

        <section className='grid gap-2'>
          <h3 className='text-sm font-semibold text-gray-800'>אוטומציות שמשתמשות בחיבור</h3>
          <p className='text-sm text-gray-600'>
            {connection.automations === 0
              ? 'אף אוטומציה עדיין לא משתמשת בחיבור הזה.'
              : `${connection.automations} אוטומציות`}
          </p>
          {connection.automations > 0 && connection.health !== 'ok' && (
            <p className='text-sm text-red-600' role='alert'>
              כל עוד החיבור אינו פעיל, האוטומציות האלה מסומנות כדורשות טיפול ולא יפעלו.
            </p>
          )}
          <p className='text-sm text-gray-500'>
            {last ? `פעילות אחרונה ${last}` : 'עדיין לא נרשמה פעילות'}
          </p>
        </section>
      </div>
    </ModalPop>
  )
}
