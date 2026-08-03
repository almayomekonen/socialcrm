'use client'

import { useEffect, useState, useTransition } from 'react'
import ModalPop from '@/lib/modals/ModalPop'
import { Btn } from '@/lib/btns/Btn'
import { Input } from '@/lib/form'
import { Seperator } from '@/lib/Seperator'
import { StatusBadge } from '@/lib/StatusBadge'
import { toast } from '@/lib/toast'
import { connectionSetup, regenerateSecret, renameSource } from '@/actions/automations/connections'
import type { SetupGuide } from '@/lib/automations/connectors/types'
import type { ConnectionView, IntegrationView } from '@/lib/automations/connectors/overview'
import SetupGuidePanel, { CopyRow } from './SetupGuidePanel'
import { DELIVERY, HEALTH, SUBSCRIPTION, errorMessage, timeAgo } from './copy'

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
  const health = HEALTH[connection.health]
  const delivery = DELIVERY[connection.delivery]
  const last = timeAgo(connection.lastActivityAt)
  const lastEvent = timeAgo(connection.lastEventAt)

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
      const res = await regenerateSecret(connection.id)
      if (res.ok === false) return toast('error', errorMessage(res.reason))
      setIssuedSecret(res.secret)
      toast('success', 'נוצר קוד סודי חדש')
      onChanged()
    })
  }

  return (
    <ModalPop open onClose={onClose} pos='top' label={connection.displayName}>
      <div className='grid gap-5 w-[min(90vw,560px)] pt-2'>
        <div className='flex items-start justify-between gap-3'>
          <div className='grid gap-1 min-w-0'>
            <h2 className='text-lg font-semibold text-gray-800 truncate'>{connection.displayName}</h2>
            <p className='text-sm text-gray-500'>{view.integration.title}</p>
          </div>
          <span className='flex shrink-0 items-center gap-2'>
            <StatusBadge role={delivery.role} label={delivery.label} size='sm' />
            {connection.health !== 'ok' && <StatusBadge role={health.role} label={health.label} size='sm' />}
          </span>
        </div>

        {delivery.hint && <p className='text-sm text-gray-500'>{delivery.hint}</p>}

        <Seperator className='my-0' />

        {setup && (
          <>
            <section className='grid gap-3'>
              <h3 className='text-sm font-semibold text-gray-800'>הגדרת החיבור</h3>
              <SetupGuidePanel guide={setup.guide} webhookUrl={setup.webhookUrl} />
              {issuedSecret ? (
                <>
                  <CopyRow label='קוד סודי חדש' value={issuedSecret} />
                  <p className='text-sm text-amber-700'>
                    הקוד מוצג פעם אחת בלבד. עדכנו אותו במערכת שלכם — עד אז לא יתקבלו נתונים.
                  </p>
                </>
              ) : (
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-sm text-gray-500'>הקוד הסודי אינו ניתן לשחזור.</span>
                  <Btn
                    variant='outline'
                    size='small'
                    lbl={rotating ? 'מייצר…' : 'יצירת קוד סודי חדש'}
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
            <p className='text-sm text-gray-500'>עדיין לא זוהו מקורות. הם יופיעו כאן אחרי הפעילות הראשונה.</p>
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
          <h3 className='text-sm font-semibold text-gray-800'>אוטומציות שמשתמשות בחיבור</h3>
          <p className='text-sm text-gray-600'>
            {connection.automations === 0 ? 'אף אוטומציה עדיין לא משתמשת בחיבור הזה.' : `${connection.automations} אוטומציות`}
          </p>
          {connection.automations > 0 && connection.health !== 'ok' && (
            <p className='text-sm text-red-600' role='alert'>
              כל עוד החיבור אינו פעיל, האוטומציות האלה מסומנות כדורשות טיפול ולא יפעלו.
            </p>
          )}
          <p className='text-sm text-gray-500'>
            {lastEvent ? `אירוע אחרון ${lastEvent}` : 'עדיין לא התקבל אירוע'}
            {connection.eventCount > 0 ? ` · ${connection.eventCount} אירועים בסך הכול` : ''}
          </p>
          <p className='text-sm text-gray-500'>{last ? `פעילות אוטומציות אחרונה ${last}` : 'עדיין לא נרשמה פעילות אוטומציות'}</p>
        </section>
      </div>
    </ModalPop>
  )
}

/**
 * One source, renameable in place.
 *
 * The provider's own label refreshes on every delivery, so a business's
 * wording is stored separately and overlaid on read — which is why renaming
 * needed no connector change and works for every integration at once.
 * Clearing the field restores the provider's name rather than blanking it.
 */
function SourceRow({
  connectionId,
  source,
  onChanged,
}: {
  connectionId: string
  source: ConnectionView['sources'][number]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(source.label)
  const [pending, start] = useTransition()
  const sub = SUBSCRIPTION[source.subscription]
  const srcHealth = HEALTH[source.health]

  function save() {
    start(async () => {
      const res = await renameSource(connectionId, source.id, label)
      if (!res.ok) return toast('error', errorMessage(res.reason ?? ''))
      setEditing(false)
      toast('success', 'השם עודכן')
      onChanged()
    })
  }

  if (editing) {
    return (
      <li className='grid gap-2'>
        <Input lbl='שם המקור' value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className='flex items-center gap-2'>
          <Btn size='small' lbl={pending ? 'שומר…' : 'שמור שם'} disabled={pending} onClick={save} />
          <Btn variant='ghost' size='small' lbl='ביטול' onClick={() => (setLabel(source.label), setEditing(false))} />
        </div>
        <p className='text-sm text-gray-500'>השארת השדה ריק תחזיר את השם המקורי.</p>
      </li>
    )
  }

  return (
    <li className='flex items-center justify-between gap-3'>
      {/* The local value, not the prop: a saved name shows immediately rather
          than reverting for the moment it takes the page to refresh. */}
      <span className='min-w-0 truncate text-sm text-gray-700'>{label}</span>
      <span className='flex shrink-0 items-center gap-2'>
        <StatusBadge role={sub.role} label={sub.label} size='xs' />
        {source.health !== 'ok' && <StatusBadge role={srcHealth.role} label={srcHealth.label} size='xs' />}
        <Btn variant='ghost' size='small' lbl='שינוי שם' icon='pen' onClick={() => setEditing(true)} />
      </span>
    </li>
  )
}
