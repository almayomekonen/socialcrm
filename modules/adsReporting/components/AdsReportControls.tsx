'use client'

import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { FormField } from '@/lib/form'
import { Btn } from '@/lib/btns/Btn'
import { ADS_RANGE_LABEL, ADS_RANGE_PRESETS, type AdsRange } from '@/lib/facebook/ads/dateRange'

const selectCls =
  'h-10 w-full rounded-md border border-gray-200 bg-white px-3 focus:outline-2 focus:outline-offset-0 focus:outline-primary'

/**
 * Ad account + date range. The selection lives in the URL (shareable, back/forward
 * restores it); the server re-validates every value before any Meta call.
 */
export default function AdsReportControls({
  accounts,
  accountId,
  range,
  today,
}: {
  accounts: { id: string; name: string }[]
  accountId: string
  range: AdsRange
  /** YYYY-MM-DD from the server — the component never reads the clock. */
  today: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [preset, setPreset] = useState<string>(range.kind === 'preset' ? range.preset : 'custom')
  const [since, setSince] = useState(range.kind === 'custom' ? range.since : '')
  const [until, setUntil] = useState(range.kind === 'custom' ? range.until : '')

  const go = (next: { account?: string; range?: string; since?: string; until?: string }) => {
    const sp = new URLSearchParams({ account: next.account ?? accountId, range: next.range ?? preset })
    if ((next.range ?? preset) === 'custom') {
      sp.set('since', next.since ?? since)
      sp.set('until', next.until ?? until)
    }
    router.push(`${pathname}?${sp.toString()}`)
  }

  const customValid = since !== '' && until !== '' && since <= until

  return (
    <div className='flex flex-wrap items-end gap-3'>
      <div className='w-64 max-w-full'>
        <FormField lbl='חשבון מודעות' htmlFor='ads-account'>
          <select id='ads-account' className={selectCls} value={accountId} onChange={(e) => go({ account: e.target.value })}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <div className='w-48 max-w-full'>
        <FormField lbl='טווח תאריכים' htmlFor='ads-range'>
          <select
            id='ads-range'
            className={selectCls}
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value)
              if (e.target.value !== 'custom') go({ range: e.target.value })
            }}
          >
            {ADS_RANGE_PRESETS.map((p) => (
              <option key={p} value={p}>
                {ADS_RANGE_LABEL[p]}
              </option>
            ))}
            <option value='custom'>{ADS_RANGE_LABEL.custom}</option>
          </select>
        </FormField>
      </div>
      {preset === 'custom' && (
        <>
          <FormField lbl='מתאריך' htmlFor='ads-since'>
            <input id='ads-since' type='date' className={selectCls} max={today} value={since} onChange={(e) => setSince(e.target.value)} />
          </FormField>
          <FormField lbl='עד תאריך' htmlFor='ads-until'>
            <input id='ads-until' type='date' className={selectCls} max={today} value={until} onChange={(e) => setUntil(e.target.value)} />
          </FormField>
          <Btn
            lbl='הצג ביצועים'
            size='medium'
            className='w-fit'
            disabled={!customValid}
            title={customValid ? undefined : 'בחר תאריך התחלה ותאריך סיום'}
            onClick={() => go({ range: 'custom' })}
          />
        </>
      )}
    </div>
  )
}
