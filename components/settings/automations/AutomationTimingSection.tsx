'use client'

import { Btn } from '@/lib/btns/Btn'
import { TIMING_ACCURACY_COPY } from '@/lib/automations/copy'
import { timingKey, timingOptionsFor } from './sheetOptions'
import type { Timing } from '@/lib/automations/timing'
import type { FieldDefinition } from '@/lib/automations/catalog/types'

/**
 * WHEN to send — the preset row, plus the honest note about accuracy.
 *
 * Extracted from AutomationSheet unchanged, to make room for the action picker
 * without crossing the file-size hard limit. One concern, no state of its own:
 * `timingOptionsFor` is what lets a saved timing the presets cannot author (an
 * anchored reminder) still round-trip instead of being overwritten.
 */

export default function AutomationTimingSection({
  timing,
  anchors,
  onChange,
}: {
  timing: Timing
  anchors: readonly FieldDefinition[]
  onChange: (next: Timing) => void
}) {
  return (
    <section className='grid gap-3'>
      <h3 className='text-sm font-semibold text-gray-800'>מתי לשלוח</h3>
      <div className='flex flex-wrap gap-2'>
        {timingOptionsFor(timing).map((t) => (
          <Btn
            key={t.key}
            variant={timingKey(timing) === t.key ? 'solid' : 'outline'}
            size='small'
            lbl={t.lbl}
            onClick={() => onChange(t.timing)}
          />
        ))}
      </div>
      {anchors.length > 0 && (
        <p className='text-sm text-gray-500 ms-1'>אפשר גם לתזמן ביחס ל{anchors.map((a) => a.label).join(' / ')}.</p>
      )}
      <p className='text-sm text-gray-500 ms-1'>{TIMING_ACCURACY_COPY}</p>
    </section>
  )
}
