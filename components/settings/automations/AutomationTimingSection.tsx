'use client'

import { Btn } from '@/lib/btns/Btn'
import { timingAccuracyIn } from '@/lib/automations/catalogI18n'
import { useT } from '@/lib/i18n/I18nProvider'
import { timingKey, timingOptionsIn } from './sheetOptions'
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
  const t = useT()
  return (
    <section className='grid gap-3'>
      <h3 className='text-sm font-semibold text-gray-800'>{t('admin.automationSheet.timing.heading')}</h3>
      <div className='flex flex-wrap gap-2'>
        {timingOptionsIn(timing, t.locale).map((o) => (
          <Btn
            key={o.key}
            variant={timingKey(timing) === o.key ? 'solid' : 'outline'}
            size='small'
            lbl={o.lbl}
            onClick={() => onChange(o.timing)}
          />
        ))}
      </div>
      {anchors.length > 0 && (
        <p className='text-sm text-gray-500 ms-1'>{t('admin.automationSheet.timing.anchors', { anchors: anchors.map((a) => a.label).join(' / ') })}</p>
      )}
      <p className='text-sm text-gray-500 ms-1'>{timingAccuracyIn(t.locale)}</p>
    </section>
  )
}
