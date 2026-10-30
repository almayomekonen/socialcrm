'use client'

import { Btn } from '@/lib/btns/Btn'
import { Select } from '@/lib/form'
import { isSelectable } from '@/lib/automations/requirements'
import RemoteParameters from './RemoteParameters'
import { useT } from '@/lib/i18n/I18nProvider'
import type { Connection, EventDefinition, ParameterDefinition, Requirement, SubjectDefinition } from '@/lib/automations/catalog/types'
import type { EvaluatedEvent } from '@/lib/automations/requirements'

/**
 * WHEN the automation should run — the event, its connection, and its parameters.
 *
 * Extracted from AutomationSheet to keep it inside the file-size hard limit once a
 * second action made the sheet grow (architecture-rules §1/§8). Nothing changed in
 * the process: the event picker is still grouped by the catalog's subjects, a
 * locked event is still shown rather than hidden, and the connection is still
 * auto-selected only when exactly one can satisfy the event.
 *
 * Names no integration, no trigger and no status — every string it renders comes
 * from catalog metadata.
 */

export default function AutomationTriggerSection({
  grouped,
  event,
  eventKey,
  locked,
  eligibleConnections,
  boundConnectionId,
  parameters,
  onEventKeyChange,
  onConnectionChange,
  onParametersChange,
}: {
  grouped: readonly { subject: SubjectDefinition; items: readonly EvaluatedEvent[] }[]
  event: EventDefinition | null
  eventKey: string
  /** The requirement blocking this event, when it is not runnable. */
  locked: Requirement | null
  eligibleConnections: readonly Connection[]
  boundConnectionId: string | null
  parameters: Record<string, string>
  onEventKeyChange: (next: string) => void
  onConnectionChange: (next: string | null) => void
  onParametersChange: (next: Record<string, string>) => void
}) {
  const t = useT()
  return (
    <section className='grid gap-3'>
      <h3 className='text-sm font-semibold text-gray-800'>{t('admin.automationSheet.trigger.heading')}</h3>
      <Select
        lbl={t('admin.automationSheet.trigger.event')}
        options={grouped.map((g) => ({
          head: g.subject.title,
          grp: g.items.map((e) => ({
            id: e.event.key,
            // A locked event stays VISIBLE and says why (§4 Q5).
            name: isSelectable(e.availability) ? e.event.title : t('admin.automationSheet.trigger.needsConnection', { event: e.event.title }),
          })),
        }))}
        value={eventKey}
        onChange={(e) => onEventKeyChange(e.target.value)}
      />
      {event && <p className='text-sm text-gray-500 ms-1'>{event.description}</p>}

      {locked && (
        <div className='border border-amber-200 rounded-md bg-amber-50 p-3 grid gap-2' role='alert'>
          <p className='text-sm text-amber-800'>{t('admin.automationSheet.trigger.locked')}</p>
          {locked.cta && <Btn variant='outline' size='small' lbl={locked.cta.label} href={locked.cta.href} />}
        </div>
      )}

      {eligibleConnections.length > 1 && (
        <Select
          lbl={t('admin.automationSheet.trigger.connection')}
          options={eligibleConnections.map((c) => ({ id: c.id, name: c.displayName }))}
          value={boundConnectionId ?? ''}
          onChange={(e) => onConnectionChange(e.target.value || null)}
        />
      )}

      {/* Exactly one — chosen for them, but never silently: the automation
          stops working if this connection is revoked, so it is named. */}
      {eligibleConnections.length === 1 && (
        <p className='text-sm text-gray-500 ms-1'>{t('admin.automationSheet.trigger.connectionNamed', { name: eligibleConnections[0].displayName })}</p>
      )}

      {/* Event parameters — rendered generically from catalog metadata. */}
      <RemoteParameters
        parameters={(event?.parameters ?? []) as readonly ParameterDefinition[]}
        connectionId={boundConnectionId}
        values={parameters}
        onChange={onParametersChange}
      />
    </section>
  )
}
