'use client'

import { useEffect, useRef, useState } from 'react'
import Icon from '@/lib/Icon'
import { importDeals, revalidateDealImport, uploadDealData, type DealImportResult } from '@/actions/dealImport'
import type { DealImportRow, RejectedDealRow } from '@/lib/deals/importMapping'
import ConfirmPop from '@/lib/modals/ConfirmPop'
import QuotaPaywallModal, { QuotaPaywallState } from '@/components/quota/QuotaPaywallModal'
import { proToast } from '@/lib/toast'
import { useAccessDenied } from '@/lib/entitlement/EntitlementContext'
import { useT, useRegionAttrs } from '@/lib/i18n/I18nProvider'

type Done = Exclude<DealImportResult, { error: 'quota_exceeded' }>

/**
 * Excel import of עסקאות: choose file → parsed and validated → confirm → import
 * → result. Built from the same parts as `UploadClientData`. The file is read by
 * the server action directly; it is not uploaded or stored (FileUploader would
 * also save it to S3 as a document, which an import must not do).
 */
export default function UploadDealsData() {
  const t = useT()
  const region = useRegionAttrs()
  const expired = useAccessDenied()
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ data: DealImportRow[]; wrong: RejectedDealRow[] } | null>(null)
  const [result, setResult] = useState<(Done & { parseRejected: RejectedDealRow[] }) | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [paywall, setPaywall] = useState<QuotaPaywallState | null>(null)
  /**
   * Refresh the deals data when the importer CLOSES, not straight after the
   * import. SalesSection keys SalesTable on its data, so an immediate refresh
   * remounts the table, and with it this modal, and the result vanishes before
   * it can be read.
   */
  const changed = useRef(false)
  useEffect(
    () => () => {
      if (changed.current) void revalidateDealImport().catch(() => {})
    },
    [],
  )

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (expired) {
      return proToast({ title: t('deals.importer.proTitle'), body: t('deals.importer.proBody'), source: 'deal_import' })
    }
    setBusy(true)
    setResult(null)
    try {
      const { data, wrongData, error } = await uploadDealData(file)
      if (error) return setErrMsg(error)
      if (!data.length) {
        return setResult({ imported: 0, duplicates: 0, createdLeads: 0, rejected: [], parseRejected: wrongData })
      }
      setPending({ data, wrong: wrongData })
    } catch {
      setErrMsg(t('deals.importer.unreadable'))
    } finally {
      setBusy(false)
    }
  }

  async function onConfirm() {
    const target = pending
    setPending(null)
    if (!target) return
    setBusy(true)
    try {
      const res = await importDeals(target.data)
      if ('error' in res) return setPaywall({ current: res.current, limit: res.limit, attempted: res.attempted })
      setResult({ ...res, parseRejected: target.wrong })
      if (res.imported > 0 || res.createdLeads > 0) changed.current = true
    } catch {
      setErrMsg(t('deals.importer.failed'))
    } finally {
      setBusy(false)
    }
  }

  const rejected = result ? [...result.parseRejected, ...result.rejected].sort((a, b) => a.row - b.row) : []
  const confirmMsg = pending
    ? pending.wrong.length
      ? t('deals.importer.confirmWithWrong', { count: String(pending.data.length), wrong: String(pending.wrong.length) })
      : t('deals.importer.confirm', { count: String(pending.data.length) })
    : ''
  // Counts as their digits (no grouping), exactly as Hebrew printed them.
  const n = (count: number) => ({ count: String(count) })

  return (
    <div className='p-4 w-[min(32rem,80vw)]' dir='rtl' {...region}>
      <div className='mb-4 font-semibold'>
        <p>{t('deals.importer.fileTitle')}</p>
        <p className='text-sm font-normal text-gray-500'>
          {t('deals.importer.fileHint')}
        </p>
      </div>

      <label className={`btn cursor-pointer w-fit ${busy ? 'opacity-50' : ''}`}>
        <Icon name='file-excel' className='size-4' />
        <p>{busy ? t('deals.importer.processing') : t('deals.importer.choose')}</p>
        <input type='file' accept='.xlsx,.xls' aria-label={t('deals.importer.chooseLabel')} onChange={onFile} className='hidden' disabled={busy} />
      </label>

      {result && (
        <div className='mt-4 space-y-3 text-sm'>
          <div className={`p-4 rounded-lg border ${result.imported ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
            <p className={`font-semibold ${result.imported ? 'text-green-800' : 'text-amber-700'}`}>
              {result.imported ? t('deals.importer.imported', n(result.imported)) : t('deals.importer.none')}
            </p>
            <div className='mt-1 space-y-0.5 text-gray-600'>
              {result.createdLeads > 0 && <p>{t('deals.importer.createdLeads', n(result.createdLeads))}</p>}
              {result.duplicates > 0 && <p className='text-blue-600'>{t('deals.importer.duplicates', n(result.duplicates))}</p>}
              {rejected.length > 0 && <p className='text-red-600'>{t('deals.importer.rejectedCount', n(rejected.length))}</p>}
            </div>
          </div>

          {rejected.length > 0 && (
            <div>
              <h2 className='underline mb-1 text-red-800 font-semibold'>{t('deals.importer.rejectedTitle')}</h2>
              <ul className='max-h-48 overflow-y-auto space-y-0.5'>
                {rejected.map((r, i) => (
                  <li key={i}>
                    {t('deals.importer.rejectedRow', { row: String(r.row), reason: r.reason })}
                    {r.label ? ` (${r.label})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ConfirmPop open={!!pending} onClose={() => setPending(null)} onConfirm={onConfirm} msg={confirmMsg} confirmLbl={t('deals.importer.confirmButton')} translated />
      <ConfirmPop open={!!errMsg} hideCancel onClose={() => setErrMsg(null)} onConfirm={() => setErrMsg(null)} msg={errMsg ?? ''} translated />
      <QuotaPaywallModal state={paywall} onClose={() => setPaywall(null)} />
    </div>
  )
}
