'use client'

import { Btn } from '@/lib/btns/Btn'
import { Input, Select } from '@/lib/form'
import type { EventDefinition } from '@/lib/automations/catalog/types'
import {
  OPERATOR_LABELS,
  conditionableFields,
  findField,
  operatorNeedsValue,
  operatorsForField,
  type Condition,
} from '@/lib/automations/conditions'

/**
 * The condition editor — generated ENTIRELY from the selected event's declared
 * fields (frozen spec §6).
 *
 * Fields come from `event.fields`; operators from each field's TYPE; values
 * from the field's declared `options` when it has them, otherwise a free input.
 * This component names no field, no status, no source and no integration. A new
 * event with new fields gets a working condition editor with zero changes here.
 */
export default function ConditionsEditor({
  event,
  conditions,
  onChange,
}: {
  event: EventDefinition | null
  conditions: Condition[]
  onChange: (next: Condition[]) => void
}) {
  const fields = event ? conditionableFields(event) : []
  if (!event || fields.length === 0) return null

  const update = (i: number, patch: Partial<Condition>) =>
    onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))

  const add = () => {
    const first = fields[0]
    const op = operatorsForField(first)[0]
    onChange([...conditions, { field: first.key, operator: op, value: first.options?.[0]?.value ?? '' }])
  }

  return (
    <section className='grid gap-3'>
      <div className='flex items-center justify-between'>
        <h3 className='text-sm font-semibold text-gray-800'>רק אם</h3>
        <Btn variant='ghost' size='small' lbl='הוספת תנאי' icon='plus' onClick={add} />
      </div>

      {conditions.length === 0 && (
        <p className='text-sm text-gray-500 ms-1'>אפשר להשאיר ריק — האוטומציה תפעל בכל פעם שהאירוע קורה.</p>
      )}

      {conditions.map((condition, i) => {
        const field = findField(event, condition.field)
        const operators = field ? operatorsForField(field) : []
        const needsValue = operatorNeedsValue(condition.operator)
        return (
          <div key={i} className='grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2 mobile:grid-cols-1'>
            <Select
              lbl={i === 0 ? 'שדה' : undefined}
              options={fields.map((f) => ({ id: f.key, name: f.label }))}
              value={condition.field}
              onChange={(e) => {
                const next = findField(event, e.target.value)
                update(i, {
                  field: e.target.value,
                  operator: next ? operatorsForField(next)[0] : condition.operator,
                  value: next?.options?.[0]?.value ?? '',
                })
              }}
            />
            <Select
              lbl={i === 0 ? 'השוואה' : undefined}
              options={operators.map((o) => ({ id: o, name: OPERATOR_LABELS[o] }))}
              value={condition.operator}
              onChange={(e) => update(i, { operator: e.target.value as Condition['operator'] })}
            />
            {needsValue ? (
              field?.options ? (
                <Select
                  lbl={i === 0 ? 'ערך' : undefined}
                  options={field.options.map((o) => ({ id: o.value, name: o.label }))}
                  value={condition.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
              ) : (
                <Input
                  lbl={i === 0 ? 'ערך' : undefined}
                  value={condition.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
              )
            ) : (
              <span />
            )}
            <Btn
              variant='ghost'
              size='small'
              lbl='הסרה'
              icon='xmark'
              onClick={() => onChange(conditions.filter((_, idx) => idx !== i))}
            />
          </div>
        )
      })}

      {conditions.some((c) => findField(event, c.field)?.freshness === 'live') && (
        <p className='text-sm text-gray-500 ms-1'>חלק מהתנאים נבדקים ברגע השליחה, לא ברגע האירוע.</p>
      )}
    </section>
  )
}
