'use client'

import { useEffect, useState } from 'react'
import { Select } from '@/lib/form'
import { listOptionsAction } from '@/actions/automations/connections'
import type { ParameterDefinition } from '@/lib/automations/catalog/types'
import type { ConnectionOption } from '@/lib/automations/catalog/types'

/**
 * Renders an event's declared parameters — generically.
 *
 * `enum_remote` is the workhorse: the catalog declares an `optionSource`, the
 * Connection layer answers with {id,label} pairs, and this component renders
 * them. It never learns whether it is showing calendars, phone numbers, pages
 * or products — which is precisely why a new integration needs no change here.
 *
 * STABLE IDS are stored; labels are display only.
 */
export default function RemoteParameters({
  parameters,
  connectionId,
  values,
  onChange,
}: {
  parameters: readonly ParameterDefinition[]
  connectionId: string | null
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
}) {
  const [options, setOptions] = useState<Record<string, ConnectionOption[]>>({})
  const remote = parameters.filter((p) => p.type === 'enum_remote')
  const staticEnums = parameters.filter((p) => p.type === 'enum_static')
  const sourceKeys = remote.map((p) => p.optionSource ?? '').join(',')

  useEffect(() => {
    if (!connectionId || remote.length === 0) return
    let cancelled = false
    ;(async () => {
      const next: Record<string, ConnectionOption[]> = {}
      for (const p of remote) {
        const res = await listOptionsAction(connectionId, p.optionSource ?? '')
        next[p.key] = res.ok ? res.options : []
      }
      if (!cancelled) setOptions(next)
    })()
    return () => {
      cancelled = true
    }
  }, [connectionId, sourceKeys])

  if (parameters.length === 0) return null

  return (
    <>
      {staticEnums.map((p) => (
        <Select
          key={p.key}
          lbl={p.label}
          options={(p.options ?? []).map((o) => ({ id: o.value, name: o.label }))}
          value={values[p.key] ?? ''}
          onChange={(e) => onChange({ ...values, [p.key]: e.target.value })}
          required={p.validation?.required ?? false}
        />
      ))}
      {remote.length > 0 && !connectionId && <p className='text-sm text-gray-500 ms-1'>יש לבחור חיבור כדי להציג את האפשרויות.</p>}
      {remote.map((p) => {
        const list = options[p.key] ?? []
        return (
          <Select
            key={p.key}
            lbl={p.label}
            // Values are STABLE IDS from the connector; labels are display only.
            options={list.map((o) => ({ id: o.id, name: o.label }))}
            value={values[p.key] ?? ''}
            onChange={(e) => onChange({ ...values, [p.key]: e.target.value })}
            required={p.validation?.required ?? false}
            placeholder={list.length === 0 ? 'אין אפשרויות זמינות' : undefined}
          />
        )
      })}
    </>
  )
}
