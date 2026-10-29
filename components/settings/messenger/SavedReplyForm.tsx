'use client'

import { Btn } from '@/lib/btns/Btn'
import { QUICK_REPLY_MAX, QUICK_REPLY_TITLE_MAX, BUTTONS_MAX, BUTTON_TITLE_MAX } from '@/lib/facebook/messenger/structured'
import type { Draft } from './savedReplyDraft'

/**
 * The saved-reply editor (split from MessengerSavedReplies): title, body, quick
 * replies, link buttons, attachment by URL, the inline error and the save /
 * cancel row. State lives in the parent; this renders it.
 */
export default function SavedReplyForm({
  draft,
  setField,
  loading,
  error,
  onSave,
  onCancel,
}: {
  draft: Draft
  setField: <K extends keyof Draft>(key: K, value: Draft[K]) => void
  loading: boolean
  error: string | null
  onSave: () => void
  onCancel: () => void
}) {
  return (
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
              icon='plus'
              lbl='הוסף תשובה מהירה'
              className='justify-self-start'
              onClick={() => setField('quickReplies', [...draft.quickReplies, ''])}
              disabled={loading}
            />
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
              icon='plus'
              lbl='הוסף כפתור'
              className='justify-self-start'
              onClick={() => setField('buttons', [...draft.buttons, { title: '', url: '' }])}
              disabled={loading}
            />
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
            className='rounded-md border border-gray-200 bg-white py-1.5 ps-2 pe-7 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
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
        <Btn lbl={loading ? 'שומר…' : 'שמור תשובה שמורה'} onClick={onSave} disabled={loading} />
        <Btn variant='ghost' lbl='ביטול' onClick={onCancel} disabled={loading} />
      </div>
    </div>
  )
}
