'use client'

import { useEffect, useState } from 'react'
import { FormField } from '@/lib/form'
import { Btn } from '@/lib/btns/Btn'
import { ADS_RANGE_LABEL, ADS_RANGE_PRESETS } from '@/lib/facebook/ads/dateRange'
import { useAdsSelection } from './AdsReportShell'

const selectCls =
  'h-10 w-full rounded-md border border-gray-200 bg-white px-3 focus:outline-2 focus:outline-offset-0 focus:outline-primary'

/**
 * Ad account + date range. The selection lives in the URL (shareable, back/forward
 * restores it) and every change goes through AdsReportShell, which shows the
 * update and guards against an older response. The controls reflect the NEWEST
 * choice immediately, even while the report still shows the previous one. The
 * server re-validates every value before any Meta call.
 */
export default function AdsReportControls({
  accounts,
  accountId,
  today,
}: {
  accounts: { id: string; name: string }[]
  /** The account the server actually reads (the URL's, if Meta lists it; else the first). */
  accountId: string
  /** YYYY-MM-DD from the server — the component never reads the clock. */
  today: string
}) {
  const { current, select } = useAdsSelection()
  const currentRange = current.range ?? 'last_30d'
  const [preset, setPreset] = useState<string>(currentRange)
  const [since, setSince] = useState(current.since ?? '')
  const [until, setUntil] = useState(current.until ?? '')

  // Back/forward or a server-side fallback can change the selection under the controls.
  useEffect(() => {
    setPreset(currentRange)
    if (currentRange === 'custom') {
      setSince(current.since ?? '')
      setUntil(current.until ?? '')
    }
  }, [currentRange, current.since, current.until])

  const customValid = since !== '' && until !== '' && since <= until

  return (
    <div className='flex flex-wrap items-end gap-3'>
      <div className='w-64 max-w-full'>
        <FormField lbl='חשבון מודעות' htmlFor='ads-account'>
          <select
            id='ads-account'
            className={selectCls}
            value={accounts.some((a) => a.id === current.account) ? current.account : accountId}
            onChange={(e) => select({ account: e.target.value })}
          >
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
              if (e.target.value !== 'custom') select({ range: e.target.value, since: '', until: '' })
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
            onClick={() => select({ range: 'custom', since, until })}
          />
        </>
      )}
    </div>
  )
}
