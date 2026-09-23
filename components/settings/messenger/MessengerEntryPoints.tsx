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

const FAILURE_COPY: Record<MessengerProfileFailure, string> = {
  not_enabled: 'Messenger אינו זמין בחשבון הזה',
  forbidden: 'רק מנהל יכול לשנות את ההגדרות האלה',
  not_found: 'הדף לא נמצא',
  permission_missing: 'חסרה הרשאת Messenger לדף. חבר מחדש את הדף ונסה שוב.',
  invalid: 'אחד השדות אינו תקין. בדוק את ההודעה ואת פריטי התפריט.',
  rate_limited: 'פייסבוק מגביל שינויים בהגדרות האלה (עד 10 שמירות ב-10 דקות). נסה שוב בעוד כמה דקות.',
  meta_error: 'פייסבוק לא אישר את השמירה. נסה שוב.',
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
        setError(FAILURE_COPY[result.reason] ?? FAILURE_COPY.meta_error)
        return
      }
      toast('success', 'ההגדרות נשמרו')
    })

  if (readFailed) {
    return (
      <div role='status' className='rounded-md border border-amber-300 bg-amber-50 p-3'>
        <p className='text-sm text-amber-800'>
          לא ניתן לקרוא כרגע את הגדרות ה-Messenger מפייסבוק. רענן את העמוד כדי לנסות שוב.
        </p>
      </div>
    )
  }

  return (
    <div className='grid gap-5'>
      <div>
        <label htmlFor='messenger-greeting' className='block text-sm font-medium text-gray-900'>
          הודעת פתיחה
        </label>
        <p className='mt-0.5 text-xs text-gray-500'>
          מוצגת לפונה לפני ההודעה הראשונה שלו, כשהוא פותח את השיחה עם הדף.
        </p>
        <textarea
          id='messenger-greeting'
          value={greeting}
          onChange={(e) => setGreeting(e.target.value.slice(0, GREETING_MAX))}
          rows={2}
          disabled={loading}
          placeholder='היי! כתבו לנו ונחזור אליכם בהקדם.'
          className='mt-1.5 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50'
        />
        <p className='mt-0.5 text-[11px] text-gray-400'>
          {greeting.length}/{GREETING_MAX} · השאר ריק כדי לא להציג הודעת פתיחה
        </p>
      </div>

      <div>
        <p className='text-sm font-medium text-gray-900'>תפריט קבוע</p>
        <p className='mt-0.5 text-xs text-gray-500'>
          עד {MENU_MAX_ITEMS} אפשרויות שהפונה יכול לבחור בתוך השיחה. בחירה תופיע אצלך בשיחה כשורה נפרדת.
        </p>
        <div className='mt-1.5 grid gap-2'>
          {Array.from({ length: MENU_MAX_ITEMS }).map((_, i) => (
            <div key={i}>
              <label htmlFor={`messenger-menu-${i}`} className='sr-only'>
                פריט {i + 1} בתפריט
              </label>
              <input
                id={`messenger-menu-${i}`}
                type='text'
                value={items[i]?.title ?? ''}
                onChange={(e) => setItem(i, e.target.value.slice(0, MENU_TITLE_MAX))}
                disabled={loading}
                placeholder={i === 0 ? 'לדוגמה: לקבלת הצעת מחיר' : 'אפשרות נוספת (לא חובה)'}
                className='w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50'
              />
            </div>
          ))}
        </div>
        <p className='mt-1 text-[11px] text-gray-400'>השאר את כל השדות ריקים כדי להסיר את התפריט.</p>
      </div>

      {error && (
        <p role='alert' className='text-sm text-error-text'>
          {error}
        </p>
      )}

      <div>
        <Btn onClick={save} disabled={loading}>
          {loading ? 'שומר…' : 'שמור שינויים'}
        </Btn>
      </div>
    </div>
  )
}
