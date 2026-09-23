'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Btn } from '@/lib/btns/Btn'
import { useAction } from '@/lib/useAction'
import { toast } from '@/lib/toast'
import type { MessengerSavedReply } from '@/db/messengerSavedReplies'
import { QUICK_REPLY_MAX, QUICK_REPLY_TITLE_MAX, BUTTONS_MAX, BUTTON_TITLE_MAX } from '@/lib/facebook/messenger/structured'
import { createSavedReply, deleteSavedReply, updateSavedReply, type SavedReplyFailure } from '@/modules/messenger/savedReplyActions'

const FAILURE_COPY: Record<SavedReplyFailure, string> = {
  not_enabled: 'Messenger אינו זמין בחשבון הזה',
  forbidden: 'רק מנהל יכול לנהל תשובות שמורות',
  not_found: 'התשובה השמורה לא נמצאה',
  title_taken: 'כבר קיימת תשובה שמורה בשם הזה',
  empty: 'תשובה שמורה חייבת לכלול טקסט או קובץ מצורף',
  too_many: 'הגעת למספר המרבי של תשובות שמורות',
  invalid: 'אחד השדות אינו תקין',
}

type Draft = {
  id: number | null
  title: string
  body: string
  quickReplies: string[]
  buttons: { title: string; url: string }[]
  attachmentUrl: string
  attachmentType: 'image' | 'video' | 'audio' | 'file'
}

const EMPTY: Draft = {
  id: null,
  title: '',
  body: '',
  quickReplies: [],
  buttons: [],
  attachmentUrl: '',
  attachmentType: 'file',
}

function toDraft(reply: MessengerSavedReply): Draft {
  return {
    id: reply.id,
    title: reply.title,
    body: reply.body,
    quickReplies: reply.quickReplies.map((q) => q.title),
    // Only web_url buttons are editable here; see the note on the form below.
    buttons: reply.buttons.filter((b) => b.type === 'web_url').map((b) => ({ title: b.title, url: b.url })),
    attachmentUrl: reply.attachmentUrl ?? '',
    attachmentType: reply.attachmentType ?? 'file',
  }
}

/**
 * Manage the agency's Messenger saved replies.
 *
 * WHY BUTTONS ARE LINK-ONLY HERE. A `postback` button sends a payload back into
 * the conversation as an event — useful, but it needs something on the other
 * end to mean anything, and SocialCRM has no automation bound to custom
 * payloads yet. Offering one would be a control that appears to do something and
 * does not. Quick replies cover the same ground honestly: the customer's tap
 * arrives as their reply, in words, which a rep can act on. `web_url` buttons
 * genuinely work with no backend at all, so those are offered.
 *
 * ATTACHMENTS ARE A URL, not an upload: Meta's reusable attachment_id expires
 * after 90 days, which would make a saved reply stop working three months later
 * with no visible cause. A URL the business controls does not expire.
 *
 * Admin-only; the server enforces it independently of whether this renders.
 */
export default function MessengerSavedReplies({ initial }: { initial: MessengerSavedReply[] }) {
  const [replies, setReplies] = useState(initial)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { loading, run } = useAction()

  const fail = (reason: SavedReplyFailure, detail?: string) => setError(detail ?? FAILURE_COPY[reason] ?? FAILURE_COPY.invalid)

  const save = () => {
    if (!draft) return
    run(async () => {
      setError(null)
      const payload = {
        title: draft.title,
        body: draft.body,
        quickReplies: draft.quickReplies.filter((t) => t.trim()).map((t) => ({ title: t.trim(), payload: t.trim() })),
        buttons: draft.buttons
          .filter((b) => b.title.trim() && b.url.trim())
          .map((b) => ({ type: 'web_url' as const, title: b.title.trim(), url: b.url.trim() })),
        attachmentUrl: draft.attachmentUrl.trim() || null,
        attachmentType: draft.attachmentUrl.trim() ? draft.attachmentType : null,
      }
      const result = draft.id ? await updateSavedReply(draft.id, payload) : await createSavedReply(payload)
      if ('reason' in result) {
        fail(result.reason, result.detail)
        return
      }
      setReplies((prev) => {
        const without = prev.filter((r) => r.id !== result.reply.id)
        return [...without, result.reply].sort((a, b) => a.title.localeCompare(b.title, 'he'))
      })
      setDraft(null)
      toast('success', 'התשובה השמורה נשמרה')
    })
  }

  const remove = (reply: MessengerSavedReply) => {
    if (!confirm(`למחוק את "${reply.title}"?`)) return
    run(async () => {
      setError(null)
      const result = await deleteSavedReply(reply.id)
      if (!result.ok) {
        fail(result.reason ?? 'not_found')
        return
      }
      setReplies((prev) => prev.filter((r) => r.id !== reply.id))
      toast('success', 'התשובה השמורה נמחקה')
    })
  }

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d))

  return (
    <div className='grid gap-4'>
      <p className='text-xs leading-relaxed text-gray-500'>
        תשובות שמורות הן קטעי טקסט לשימוש חוזר בשיחות Messenger. אלה אינן תבניות WhatsApp ואינן דורשות אישור של Meta.
      </p>

      {replies.length > 0 && (
        <ul className='grid gap-1.5'>
          {replies.map((reply) => (
            <li
              key={reply.id}
              className='flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2'
            >
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium text-gray-900'>{reply.title}</p>
                {reply.body && <p className='mt-0.5 truncate text-xs text-gray-500'>{reply.body}</p>}
                {(reply.quickReplies.length > 0 || reply.buttons.length > 0 || reply.attachmentUrl) && (
                  <p className='mt-0.5 text-[11px] text-gray-400'>
                    {[
                      reply.quickReplies.length > 0 ? `${reply.quickReplies.length} תשובות מהירות` : null,
                      reply.buttons.length > 0 ? `${reply.buttons.length} כפתורים` : null,
                      reply.attachmentUrl ? 'קובץ מצורף' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>
              <Btn variant='outline' size='small' onClick={() => setDraft(toDraft(reply))} disabled={loading}>
                ערוך
              </Btn>
              <button
                type='button'
                onClick={() => remove(reply)}
                disabled={loading}
                aria-label={`מחק את ${reply.title}`}
                title={`מחק את ${reply.title}`}
                className='flex size-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40'
              >
                <Trash2 aria-hidden className='size-3.5' />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!draft && (
        <div>
          <Btn variant='outline' onClick={() => setDraft({ ...EMPTY })} disabled={loading}>
            <Plus aria-hidden className='size-4' />
            הוסף תשובה שמורה
          </Btn>
        </div>
      )}

      {draft && (
        <div className='grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3'>
          <div>
            <label htmlFor='sr-title' className='block text-sm font-medium text-gray-900'>
              שם (מוצג לך בלבד)
            </label>
            <input
              id='sr-title'
              value={draft.title}
              onChange={(e) => setField('title', e.target.value)}
              disabled={loading}
              placeholder='לדוגמה: שעות פעילות'
              className='mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
            />
          </div>

          <div>
            <label htmlFor='sr-body' className='block text-sm font-medium text-gray-900'>
              תוכן ההודעה
            </label>
            <textarea
              id='sr-body'
              value={draft.body}
              onChange={(e) => setField('body', e.target.value)}
              rows={3}
              disabled={loading}
              placeholder='אנחנו פתוחים א׳-ה׳ בין 9:00 ל-17:00.'
              className='mt-1 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
            />
          </div>

          <fieldset>
            <legend className='text-sm font-medium text-gray-900'>תשובות מהירות (לא חובה)</legend>
            <p className='mt-0.5 text-xs text-gray-500'>
              כפתורי בחירה מהירים. לחיצה של הפונה מגיעה אליך כהודעה רגילה עם הטקסט שנבחר.
            </p>
            <div className='mt-1.5 grid gap-1.5'>
              {draft.quickReplies.map((value, i) => (
                <input
                  key={i}
                  value={value}
                  onChange={(e) => {
                    const next = [...draft.quickReplies]
                    next[i] = e.target.value.slice(0, QUICK_REPLY_TITLE_MAX)
                    setField('quickReplies', next)
                  }}
                  disabled={loading}
                  aria-label={`תשובה מהירה ${i + 1}`}
                  className='w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
                />
              ))}
              {draft.quickReplies.length < QUICK_REPLY_MAX && (
                <Btn
                  variant='ghost'
                  size='small'
                  onClick={() => setField('quickReplies', [...draft.quickReplies, ''])}
                  disabled={loading}
                >
                  <Plus aria-hidden className='size-3.5' />
                  הוסף תשובה מהירה
                </Btn>
              )}
            </div>
          </fieldset>

          <fieldset>
            <legend className='text-sm font-medium text-gray-900'>כפתורי קישור (לא חובה)</legend>
            <p className='mt-0.5 text-xs text-gray-500'>עד {BUTTONS_MAX} כפתורים שפותחים כתובת אינטרנט.</p>
            <div className='mt-1.5 grid gap-1.5'>
              {draft.buttons.map((b, i) => (
                <div key={i} className='grid grid-cols-2 gap-1.5'>
                  <input
                    value={b.title}
                    onChange={(e) => {
                      const next = [...draft.buttons]
                      next[i] = { ...b, title: e.target.value.slice(0, BUTTON_TITLE_MAX) }
                      setField('buttons', next)
                    }}
                    disabled={loading}
                    placeholder='טקסט הכפתור'
                    aria-label={`טקסט כפתור ${i + 1}`}
                    className='rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
                  />
                  <input
                    value={b.url}
                    onChange={(e) => {
                      const next = [...draft.buttons]
                      next[i] = { ...b, url: e.target.value }
                      setField('buttons', next)
                    }}
                    disabled={loading}
                    dir='ltr'
                    placeholder='https://'
                    aria-label={`כתובת כפתור ${i + 1}`}
                    className='rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
                  />
                </div>
              ))}
              {draft.buttons.length < BUTTONS_MAX && (
                <Btn
                  variant='ghost'
                  size='small'
                  onClick={() => setField('buttons', [...draft.buttons, { title: '', url: '' }])}
                  disabled={loading}
                >
                  <Plus aria-hidden className='size-3.5' />
                  הוסף כפתור
                </Btn>
              )}
            </div>
          </fieldset>

          <div>
            <label htmlFor='sr-attachment' className='block text-sm font-medium text-gray-900'>
              קובץ מצורף לפי כתובת (לא חובה)
            </label>
            <p className='mt-0.5 text-xs text-gray-500'>
              כתובת https שפייסבוק יכול להוריד ממנה, למשל מחירון באתר שלך.
            </p>
            <div className='mt-1.5 grid grid-cols-[1fr_auto] gap-1.5'>
              <input
                id='sr-attachment'
                value={draft.attachmentUrl}
                onChange={(e) => setField('attachmentUrl', e.target.value)}
                disabled={loading}
                dir='ltr'
                placeholder='https://example.com/pricing.pdf'
                className='rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
              />
              <select
                value={draft.attachmentType}
                onChange={(e) => setField('attachmentType', e.target.value as Draft['attachmentType'])}
                disabled={loading}
                aria-label='סוג הקובץ המצורף'
                className='rounded-md border border-gray-200 bg-white px-2 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
              >
                <option value='file'>קובץ</option>
                <option value='image'>תמונה</option>
                <option value='video'>סרטון</option>
                <option value='audio'>אודיו</option>
              </select>
            </div>
          </div>

          {error && (
            <p role='alert' className='text-sm text-error-text'>
              {error}
            </p>
          )}

          <div className='flex gap-2'>
            <Btn onClick={save} disabled={loading}>
              {loading ? 'שומר…' : 'שמור תשובה שמורה'}
            </Btn>
            <Btn variant='ghost' onClick={() => { setDraft(null); setError(null) }} disabled={loading}>
              ביטול
            </Btn>
          </div>
        </div>
      )}

      {!draft && error && (
        <p role='alert' className='text-sm text-error-text'>
          {error}
        </p>
      )}
    </div>
  )
}
