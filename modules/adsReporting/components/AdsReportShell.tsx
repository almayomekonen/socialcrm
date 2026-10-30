'use client'

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Icon from '@/lib/Icon'
import { useT } from '@/lib/i18n/I18nProvider'
import { adsSelectionHref, adsSelectionKey, nextAdsSelection, type AdsSelectionQuery } from '@/lib/facebook/ads/selection'

/**
 * Owns the report's selection while the server fetches Meta's numbers.
 *
 * A change is a URL navigation inside a transition, so the previous report stays
 * on screen (layout stable, no full-page spinner) and this shell says so: the
 * status line switches to "מעדכן נתונים…" and names the selection the visible
 * numbers still belong to, and the report dims with aria-busy.
 *
 * NEVER STALE-AS-CURRENT. The server renders the raw query it answered
 * (`rendered`); the shell remembers the newest selection the user asked for. The
 * report counts as current only when the two keys match. If every navigation has
 * settled on something older — an earlier, slower response — the newest
 * selection is requested again, once. Back/forward is the user's own choice and
 * is accepted as-is.
 */

type AdsSelectionContextValue = {
  /** The selection the controls should show: the newest request, else what is rendered. */
  current: AdsSelectionQuery
  updating: boolean
  select: (change: AdsSelectionQuery) => void
  retry: () => void
}

export const AdsSelectionContext = createContext<AdsSelectionContextValue | null>(null)

export function useAdsSelection(): AdsSelectionContextValue {
  const value = useContext(AdsSelectionContext)
  if (!value) throw new Error('useAdsSelection must be used inside AdsReportShell')
  return value
}

export default function AdsReportShell({
  rendered,
  renderedLabel,
  controls,
  children,
}: {
  rendered: AdsSelectionQuery
  /** Human description of what the visible report shows, e.g. "Socialcrm Ads · 30 ימים אחרונים". */
  renderedLabel: string
  controls: ReactNode
  children: ReactNode
}) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [requested, setRequested] = useState<AdsSelectionQuery | null>(null)
  const reissuedFor = useRef<string | null>(null)
  /** An older selection landed while the newest was still outstanding. */
  const staleLanded = useRef(false)
  const historyNavigation = useRef(false)

  const renderedKey = adsSelectionKey(rendered)
  const requestedKey = requested ? adsSelectionKey(requested) : null

  useEffect(() => {
    const onPop = () => {
      // History navigation abandons a pending choice — even one that lands on the
      // same selection key, which would otherwise leave "מעדכן נתונים…" up.
      historyNavigation.current = true
      setRequested(null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const previousRenderedKey = useRef(renderedKey)
  useEffect(() => {
    const landed = previousRenderedKey.current !== renderedKey
    previousRenderedKey.current = renderedKey
    if (!requested || requestedKey === null) return
    if (requestedKey === renderedKey) {
      setRequested(null)
      reissuedFor.current = null
      staleLanded.current = false
      return
    }
    // Only a report that actually LANDED on another selection matters; merely
    // waiting for the newest one is what "מעדכן נתונים…" already says.
    if (landed && historyNavigation.current) {
      historyNavigation.current = false
      setRequested(null)
      return
    }
    if (landed) staleLanded.current = true
    if (!staleLanded.current || isPending || reissuedFor.current === requestedKey) return
    staleLanded.current = false
    reissuedFor.current = requestedKey
    startTransition(() => router.replace(adsSelectionHref(pathname, requested), { scroll: false }))
  }, [requested, requestedKey, renderedKey, isPending, pathname, router])

  const current = requested ?? rendered
  const updating = isPending || (requestedKey !== null && requestedKey !== renderedKey)

  const select = (change: AdsSelectionQuery) => {
    const next = nextAdsSelection(current, change)
    if (adsSelectionKey(next) === adsSelectionKey(current)) return
    historyNavigation.current = false
    setRequested(next)
    startTransition(() => router.push(adsSelectionHref(pathname, next), { scroll: false }))
  }

  const retry = () => startTransition(() => router.refresh())

  return (
    <AdsSelectionContext.Provider value={{ current, updating, select, retry }}>
      <div className='grid gap-4'>
        {controls}
        {/* One fixed slot for "what am I looking at" — it changes wording, never the layout. */}
        <div role='status' className='flex min-h-9 flex-wrap items-center gap-2 text-sm' data-testid='ads-report-status'>
          {updating ? (
            <span className='flex flex-wrap items-center gap-2 rounded-md bg-softy px-3 py-1.5 text-solid'>
              <Icon name='spinner' className='size-4 animate-spin bg-solid' />
              <span className='font-medium'>{t('performance.ads.shell.updating')}</span>
              <span className='text-gray-600'>{t('performance.ads.shell.previous', { label: renderedLabel })}</span>
            </span>
          ) : (
            <span className='text-gray-600'>{t('performance.ads.shell.current', { label: renderedLabel })}</span>
          )}
        </div>
        <div aria-busy={updating} className={`transition-opacity duration-150 ${updating ? 'opacity-50' : ''}`} data-testid='ads-report-body'>
          {children}
        </div>
      </div>
    </AdsSelectionContext.Provider>
  )
}
