'use client'

import { useEffect, useState } from 'react'
import Icon from './Icon'
import { upgradeHref } from './entitlement/upgradeHref'
import { proToastChrome } from './toastChrome'

/**
 * `pro` is a SUBSCRIPTION ACTION, not an application error.
 *
 * A lapsed subscription is a known, deliberate refusal with a way out, so it
 * must not borrow the red error treatment reserved for things that broke. This
 * variant wears the same warm tokens as the renewal banner on the settings
 * pages (`warning-bg` / `warning-border` / `warning-text`) so the two read as
 * one system, and it carries a title, a line of body copy and a link into the
 * EXISTING billing route.
 */
type PopIcon = 'success' | 'error' | 'loading' | 'ban' | 'hide' | 'message' | 'pro'

type ProToast = { title: string; body: string; source: string; cta?: string }

let popEl: HTMLElement | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null
let announceTimer: ReturnType<typeof setTimeout> | null = null

export let toast: (icon: PopIcon, msg?: string, durationMs?: number, onClick?: () => void) => void = () => {}

/**
 * The subscription toast. Same popover, same timers, different clothes — a
 * variant of the existing toast rather than a second notification system.
 *
 * Held twice as long as a confirmation: it asks the customer to decide
 * something, so it must outlast a glance.
 */
export let proToast: (opts: ProToast) => void = () => {}

const HEBREW_DEFAULTS: { [key in PopIcon]: string } = {
  success: 'בוצע בהצלחה!',
  error: 'אירעה שגיאה!',
  loading: 'טוען...',
  ban: 'אינך מורשה',
  hide: '',
  message: 'הודעה חדשה',
  // The pro variant always supplies its own copy; this is only the type's floor.
  pro: 'הפעולה זמינה עם Pro',
}

/**
 * Text used when a caller passes no message. Hebrew unless the interface
 * language provider overrides it: the toast lives in the root layout, outside
 * that provider, so the provider pushes its defaults here instead. Every
 * existing `toast(kind)` / `api(fn, data)` call keeps its signature.
 */
let defaultMsg: { [key in PopIcon]: string } = { ...HEBREW_DEFAULTS }

export type ToastDefaults = Partial<Record<Exclude<PopIcon, 'hide'>, string>>

export function setToastDefaults(msgs: ToastDefaults) {
  defaultMsg = { ...HEBREW_DEFAULTS, ...msgs }
}

export function resetToastDefaults() {
  defaultMsg = { ...HEBREW_DEFAULTS }
}

export default function ToastMsg() {
  const [pop, setPop] = useState<{ icon: PopIcon; msg: string; onClick?: () => void; pro?: ProToast }>({
    icon: 'loading',
    msg: defaultMsg['loading'],
  })

  const [live, setLive] = useState('')

  useEffect(() => {
    popEl = document.getElementById('popMsg')
  }, [])

  toast = function (icon: PopIcon, msg?: string, durationMs?: number, onClick?: () => void) {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
    if (announceTimer) { clearTimeout(announceTimer); announceTimer = null }
    const text = msg || defaultMsg[icon]
    setPop({ icon, msg: text, onClick })
    if (icon === 'hide') { popEl?.hidePopover(); setLive(''); return }
    popEl?.showPopover()
    setLive('')
    announceTimer = setTimeout(() => { setLive(text); announceTimer = null }, 60)
    if (icon !== 'loading') closeTimer = setTimeout(() => { popEl?.hidePopover(); closeTimer = null }, durationMs ?? 3000)
  }

  proToast = function (opts: ProToast) {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
    if (announceTimer) { clearTimeout(announceTimer); announceTimer = null }
    setPop({ icon: 'pro', msg: opts.body, pro: opts })
    popEl?.showPopover()
    setLive('')
    announceTimer = setTimeout(() => { setLive(`${opts.title}. ${opts.body}`); announceTimer = null }, 60)
    closeTimer = setTimeout(() => { popEl?.hidePopover(); closeTimer = null }, 7000)
  }

  // The interface language's chrome (lib/toastChrome.ts); Hebrew when none is pushed.
  const proLang = pop.pro ? proToastChrome() : null

  const body = (
    <div className='flex items-center gap-4 ps-6 pe-9 py-3 font-medium text-white'>
      {icons[pop.icon]}
      <h3 className='font-medium whitespace-pre-line leading-snug'>{pop.msg}</h3>
    </div>
  )

  return (
    <>
      <div role='status' aria-live='polite' aria-atomic='true' className='sr-only'>
        {live}
      </div>
      <div className={pop.icon === 'pro' ? 'toast toast-pro' : 'toast'} popover='auto' id='popMsg'>
        {pop.icon === 'pro' && pop.pro ? (
          <div dir={proLang?.attrs.dir ?? 'rtl'} lang={proLang?.attrs.lang} className='flex items-start gap-3 px-5 py-4' data-testid='pro-toast'>
            {icons.pro}
            <div className='min-w-0'>
              <h3 className='text-[15px] font-semibold leading-snug text-warning-text'>{pop.pro.title}</h3>
              <p className='mt-1 text-[13px] leading-snug text-warning-text/85'>{pop.pro.body}</p>
              <a
                href={upgradeHref(pop.pro.source)}
                className='mt-2 inline-block text-[13px] font-semibold text-warning-text underline underline-offset-2'
              >
                {pop.pro.cta ?? proLang?.cta ?? 'חידוש מנוי'}
              </a>
            </div>
          </div>
        ) : pop.onClick ? (
          <button
            type='button'
            className='w-full cursor-pointer text-start'
            onClick={() => {
              pop.onClick?.()
              popEl?.hidePopover()
            }}
          >
            {body}
          </button>
        ) : (
          body
        )}
      </div>
    </>
  )
}

const icons = {
  success: <Icon name='check' type='reg' className='bg-white rtl:scale-x-100 size-5' />,
  error: <Icon name='triangle-exclamation' type='reg' className='bg-white size-5' />,
  ban: <Icon name='ban' type='reg' className='bg-white size-5' />,
  loading: <div className='size-5 border-2 rounded-full border-white animate-spin border-t-transparent' />,
  message: <Icon name='comment-dots' type='reg' className='bg-white size-5' />,
  pro: <Icon name='lock' type='sol' className='bg-warning-text size-5 shrink-0 mt-0.5' />,
}
