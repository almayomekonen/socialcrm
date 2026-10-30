'use client'

import InvoiceLinesEditor, { type EditableLine, type LineFormPayload } from '../InvoiceLinesEditor'
import { cardCls, sectionHeaderCls, eyebrowCls } from './styles'
import { useT } from '@/lib/i18n/I18nProvider'

/** The new-invoice editor's items card: heading, keyboard hint, the lines table, the first-line hint. */
export default function NewInvoiceLinesCard({
  lines,
  onAdd,
  onUpdate,
  onRemove,
}: {
  lines: readonly EditableLine[]
  onAdd: (payload: LineFormPayload) => void
  onUpdate: (lineId: number, payload: LineFormPayload) => void
  onRemove: (lineId: number) => void
}) {
  const t = useT()
  return (
    <section className={cardCls}>
      <div className={sectionHeaderCls + ' flex items-baseline justify-between gap-3'}>
        <h2 className={eyebrowCls}>{t('billing.editor.lines.heading')}</h2>
        <p className='text-sm text-gray-400'>{t('billing.editor.lines.keyboardHint')}</p>
      </div>
      <InvoiceLinesEditor lines={lines} onAdd={onAdd} onUpdate={onUpdate} onRemove={onRemove} />
      {lines.length === 0 && (
        <p className='px-6 pb-5 -mt-1 text-sm text-gray-500'>
          {t('billing.editor.lines.firstLineHint')}
        </p>
      )}
    </section>
  )
}
