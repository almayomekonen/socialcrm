'use client'

import { useTopLayerPromotion } from '@/lib/useTopLayer'
import LeadPickerRow, { dropdownGroupHeaderCls } from './LeadPickerRow'
import type { RecentLead } from './types'

/**
 * The portal-rendered dropdown body. Pulled out so LeadPicker stays
 * focused on state + positioning, and the panel JSX stays glanceable.
 */
export default function LeadPickerPanel({
  panelRef,
  pos,
  canTopLayer,
  query,
  setQuery,
  results,
  currentLeadId,
  onPickLead,
  onCreateNew,
}: {
  panelRef: React.RefObject<HTMLDivElement>
  pos: { top: number; right: number; width: number }
  canTopLayer: boolean
  query: string
  setQuery: (q: string) => void
  results: ReadonlyArray<RecentLead>
  currentLeadId: number
  onPickLead: (id: number) => void
  onCreateNew: () => void
}) {
  // Held in the top layer for as long as the panel is open. Mounted only while
  // open, so mounting IS opening and the promotion needs no further condition.
  useTopLayerPromotion(panelRef, canTopLayer)

  const billed = results.filter((l) => (l.invoiceCount ?? 0) > 0)
  const unbilled = results.filter((l) => !(l.invoiceCount ?? 0))
  const showGroups = query.trim().length === 0 && billed.length > 0 && unbilled.length > 0

  return (
    <div
      ref={panelRef}
      /**
       * TWO layers, in priority order.
       *
       * `popover='manual'` is the one that decides: this picker is opened from
       * inside ModalPop, whose scrim now sits in the browser's TOP LAYER, which
       * paints above every ordinary stacking context no matter how high a
       * z-index climbs. A body-portalled panel therefore rendered BEHIND the
       * dialog that opened it — the meeting form's lead picker, unusable. See
       * `lib/useTopLayer.ts`.
       *
       * `zIndex: 100000` remains the app's PORTAL-POPOVER LAYER and is the
       * fallback for engines with no top layer: OutcomeControl and
       * LeadQuickActions portal to `document.body` at exactly this value,
       * chosen to sit above ModalPop's `z-99999`. Set inline rather than as a
       * class to match those two call sites exactly.
       *
       * The mechanics deliberately do NOT move to `useFloatingMenu`: that hook
       * CLOSES on scroll, while this picker RE-MEASURES so the panel tracks its
       * trigger — which is what keeps it usable inside a scrollable dialog body.
       * Adopting the hook would regress that.
       */
      popover={canTopLayer ? 'manual' : undefined}
      style={{
        position: 'fixed',
        /**
         * The UA sheet's `[popover]` box, undone so the panel's own classes stay
         * authoritative. Only what preflight does NOT already zero is listed:
         * `inset: 0` would stretch the panel to the viewport's bottom-left,
         * `display: none` hides it until it is shown, and `color: CanvasText`
         * would stop text inheriting the app's ink. Order matters — `inset`
         * must be written before the `top`/`right` that place the panel.
         */
        ...(canTopLayer
          ? { display: 'block', inset: 'auto', height: 'auto', color: 'inherit' }
          : null),
        top: pos.top,
        right: pos.right,
        width: pos.width,
        zIndex: 100000,
      }}
      className='bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden'
    >
      <input
        type='text'
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder='חיפוש לקוח/ה...'
        autoFocus
        className='w-full h-10 px-3 border-b border-gray-100 bg-gray-50 focus:bg-white focus:outline-none text-base placeholder:text-gray-400'
      />
      <div className='max-h-72 overflow-y-auto'>
        {results.length === 0 ? (
          <p className='px-3 py-6 text-sm text-gray-500 text-center'>אין תוצאות</p>
        ) : !showGroups ? (
          results.map((lead) => (
            <LeadPickerRow
              key={lead.id}
              lead={lead}
              isCurrent={lead.id === currentLeadId}
              onClick={() => onPickLead(lead.id)}
            />
          ))
        ) : (
          <>
            <div className={dropdownGroupHeaderCls}>כבר חויבו</div>
            {billed.map((lead) => (
              <LeadPickerRow
                key={lead.id}
                lead={lead}
                isCurrent={lead.id === currentLeadId}
                onClick={() => onPickLead(lead.id)}
              />
            ))}
            <div className={dropdownGroupHeaderCls}>לידים אחרונים</div>
            {unbilled.map((lead) => (
              <LeadPickerRow
                key={lead.id}
                lead={lead}
                isCurrent={lead.id === currentLeadId}
                onClick={() => onPickLead(lead.id)}
              />
            ))}
          </>
        )}
      </div>
      <button
        type='button'
        onClick={onCreateNew}
        className='border-t border-gray-200 px-3 py-3 hover:bg-gray-50 text-sm font-medium text-solid flex items-center gap-1.5 bg-white shrink-0 w-full'
      >
        <span aria-hidden>+</span>
        <span>יצירת לקוח/ה חדש/ה</span>
      </button>
    </div>
  )
}
