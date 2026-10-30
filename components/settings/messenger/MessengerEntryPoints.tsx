'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import {
  GREETING_MAX,
  MENU_MAX_ITEMS,
  MENU_TITLE_MAX,
  type MessengerProfileConfig,
} from '@/lib/facebook/messenger/messengerProfileApi'
import { updateMessengerProfile, type MessengerProfileFailure } from '@/modules/messenger/profileActions'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

const FAILURE_COPY: Record<MessengerProfileFailure, MessageKey> = {
  not_enabled: 'settings.messenger.entry.failure.not_enabled',
  forbidden: 'settings.messenger.entry.failure.forbidden',
  not_found: 'settings.messenger.entry.failure.not_found',
  permission_missing: 'settings.messenger.entry.failure.permission_missing',
  invalid: 'settings.messenger.entry.failure.invalid',
  rate_limited: 'settings.messenger.entry.failure.rate_limited',
  meta_error: 'settings.messenger.entry.failure.meta_error',
}

/**
 * What a customer sees BEFORE they have written anything: the greeting, and the
 * menu inside the Messenger conversation.
 *
 * ADMIN ONLY — this is Page-wide, not per-rep, and the server enforces it
 * independently of whether this form is rendered.
 *
 * SAVES EXPLICITLY, never on change. Meta allows ten writes per ten minutes per
 * Page; an autosave would burn that in one editing session and start refusing.
 *
 * The Get Started button is not exposed as a field. It has to exist for a
 * persistent menu to be allowed at all, its payload is meaningless to a
 * business owner, and the only useful thing about it — that a customer tapped
 * it — already appears in the conversation. It is sent for them.
 */
export default function MessengerEntryPoints({
  pageId,
  initial,
  readFailed,
}: {
  pageId: string
  initial: MessengerProfileConfig
  /** True when the current settings could not be read from Meta. */
  readFailed: boolean
}) {
  const t = useT()
  const [greeting, setGreeting] = useState(initial.greeting)
  const [items, setItems] = useState(initial.menuItems)
  const [error, setError] = useState<string | null>(null)
  const { loading, run } = useAction()

  const setItem = (index: number, title: string) =>
    setItems((prev) => {
      const next = [...prev]
      next[index] = { type: 'postback', title, payload: next[index]?.payload || title }
      return next
    })

  const save = () =>
    run(async () => {
      setError(null)
      const result = await updateMessengerProfile(pageId, {
        greeting,
        getStartedPayload: initial.getStartedPayload,
        // A blank row is a row the admin cleared, not an item.
        menuItems: items.filter((i) => i.title.trim()),
        composerInputDisabled: false,
      })
      if ('reason' in result) {
        setError(t(FAILURE_COPY[result.reason] ?? FAILURE_COPY.meta_error))
        return
      }
      toast('success', t('settings.messenger.entry.saved'))
    })

  if (readFailed) {
    return (
      <div role='status' className='rounded-md border border-amber-300 bg-amber-50 p-3'>
        <p className='text-sm text-amber-800'>
          {t('settings.messenger.entry.readFailed')}
        </p>
      </div>
    )
  }

  return (
    <div className='grid gap-5'>
      <div>
        <label htmlFor='messenger-greeting' className='block text-sm font-medium text-gray-900'>
          {t('settings.messenger.entry.greeting')}
        </label>
        <p className='mt-0.5 text-xs text-gray-500'>
          {t('settings.messenger.entry.greetingHint')}
        </p>
        <textarea
          id='messenger-greeting'
          value={greeting}
          onChange={(e) => setGreeting(e.target.value.slice(0, GREETING_MAX))}
          rows={2}
          disabled={loading}
          placeholder={t('settings.messenger.entry.greetingPlaceholder')}
          className='mt-1.5 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50'
        />
        <p className='mt-0.5 text-[11px] text-gray-400'>
          {greeting.length}/{GREETING_MAX} {t('settings.messenger.entry.greetingEmpty')}
        </p>
      </div>

      <div>
        <p className='text-sm font-medium text-gray-900'>{t('settings.messenger.entry.menu')}</p>
        <p className='mt-0.5 text-xs text-gray-500'>
          {t('settings.messenger.entry.menuHint', { count: String(MENU_MAX_ITEMS) })}
        </p>
        <div className='mt-1.5 grid gap-2'>
          {Array.from({ length: MENU_MAX_ITEMS }).map((_, i) => (
            <div key={i}>
              <label htmlFor={`messenger-menu-${i}`} className='sr-only'>
                {t('settings.messenger.entry.menuItem', { n: String(i + 1) })}
              </label>
              <input
                id={`messenger-menu-${i}`}
                type='text'
                value={items[i]?.title ?? ''}
                onChange={(e) => setItem(i, e.target.value.slice(0, MENU_TITLE_MAX))}
                disabled={loading}
                placeholder={i === 0 ? t('settings.messenger.entry.menuFirstPlaceholder') : t('settings.messenger.entry.menuMorePlaceholder')}
                className='w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50'
              />
            </div>
          ))}
        </div>
        <p className='mt-1 text-[11px] text-gray-400'>{t('settings.messenger.entry.menuEmpty')}</p>
      </div>

      {error && (
        <p role='alert' className='text-sm text-error-text'>
          {error}
        </p>
      )}

      <div>
        <Btn lbl={loading ? t('settings.messenger.entry.saving') : t('settings.messenger.entry.save')} onClick={save} disabled={loading} />
      </div>
    </div>
  )
}
