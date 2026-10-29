'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import { firstRunCopy } from '@/lib/activation/firstRunCopy'
import { useT } from '@/lib/i18n/I18nProvider'
import { dirFor, regionAttrs } from '@/lib/i18n/config'

/**
 * The state nobody had designed: leads just landed, and now what?
 *
 * Import used to end at `router.refresh()`, which swapped a guided empty screen
 * for an ordinary table and said nothing. In production five of six leads
 * created by new agencies were never opened again, and `first_follow_up_set`
 * had never fired once — the loop had no next step after the data arrived.
 *
 * This is deliberately the SAME idiom as `FirstLeadCallout`: an inline banner
 * above the existing table, never a modal, a tour, or a new layout layer
 * (`ux-guidelines.md` §11). It names what happened, names the one action worth
 * taking, and hands the user into the EXISTING first-lead flow by opening a
 * real lead with `?firstLead=1` — so an import and a manual create converge on
 * one loop instead of two.
 *
 * One-shot: the params are stripped on the first interaction, so a refresh or a
 * back-navigation never replays it.
 */
export default function FirstImportCallout({
  count,
  leadId,
  skipped = 0,
}: {
  count: number
  leadId?: number
  /** Rows the file carried that could not be imported. */
  skipped?: number
}) {
  const t = useT()
  const C = firstRunCopy(t.locale)
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || count <= 0) return null

  /** Drop the one-shot params without adding a history entry. */
  function clearParams() {
    const next = new URLSearchParams(sp.toString())
    next.delete('firstImport')
    next.delete('firstLeadId')
    next.delete('firstImportSkipped')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <div
      role='status'
      dir={dirFor(t.locale)}
      {...regionAttrs(t.locale)}
      className='mb-4 flex items-start gap-3 rounded-lg border border-gray-200 bg-primary-tint px-4 py-3'
    >
      <span className='flex size-8 flex-none items-center justify-center rounded-lg bg-white'>
        <Icon name='circle-check' type='reg' className='size-4 bg-primary' />
      </span>

      <div className='flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3'>
        <div className='min-w-0'>
          <h2 className='text-sm font-bold text-ink'>{C.firstImport.title(count)}</h2>
          <p className='mt-0.5 text-sm text-gray-600'>{C.firstImport.body}</p>
          {skipped > 0 && (
            <p className='mt-1 text-sm text-warning-text'>{C.firstImport.skipped(skipped)}</p>
          )}
        </div>

        {/* Only offered when we actually have a lead to open. Without an id the
            banner still reports the import honestly rather than linking nowhere. */}
        {leadId ? (
          <Btn
            variant='solid'
            size='small'
            /* `size='small'` renders 36px — fine under a mouse, under the
               comfortable touch target on a phone, and this banner now renders
               on BOTH surfaces. Measured at 390px during browser QA. */
            className='mobile:min-h-11 mobile:w-full mobile:justify-center'
            lbl={C.firstImport.cta}
            onClick={() => {
              clearParams()
              router.push(`/clients/${leadId}/summary?firstLead=1`)
            }}
          />
        ) : null}
      </div>

      <button
        type='button'
        aria-label={C.firstImport.dismiss}
        onClick={() => {
          setDismissed(true)
          clearParams()
        }}
        className='flex-none rounded p-0.5 text-gray-400 hover:text-gray-600'
      >
        <Icon name='xmark' type='reg' className='size-3.5 bg-gray-400' />
      </button>
    </div>
  )
}
