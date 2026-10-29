'use client'

import { Btn } from '@/lib/btns/Btn'
import { QUICK_REPLY_MAX, QUICK_REPLY_TITLE_MAX, BUTTONS_MAX, BUTTON_TITLE_MAX } from '@/lib/facebook/messenger/structured'
import type { Draft } from './savedReplyDraft'
import { useT } from '@/lib/i18n/I18nProvider'

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
  const t = useT()
  return (
    <div className='grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3'>
      <div>
        <label htmlFor='sr-title' className='block text-sm font-medium text-gray-900'>
          {t('settings.messenger.replies.name')}
        </label>
        <input
          id='sr-title'
          value={draft.title}
          onChange={(e) => setField('title', e.target.value)}
          disabled={loading}
          placeholder={t('settings.messenger.replies.namePlaceholder')}
          className='mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
        />
      </div>

      <div>
        <label htmlFor='sr-body' className='block text-sm font-medium text-gray-900'>
          {t('settings.messenger.replies.body')}
        </label>
        <textarea
          id='sr-body'
          value={draft.body}
          onChange={(e) => setField('body', e.target.value)}
          rows={3}
          disabled={loading}
          placeholder={t('settings.messenger.replies.bodyPlaceholder')}
          className='mt-1 w-full resize-none rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
        />
      </div>

      <fieldset>
        <legend className='text-sm font-medium text-gray-900'>{t('settings.messenger.replies.quick')}</legend>
        <p className='mt-0.5 text-xs text-gray-500'>
          {t('settings.messenger.replies.quickHint')}
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
              aria-label={t('settings.messenger.replies.quickLabel', { n: String(i + 1) })}
              className='w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
            />
          ))}
          {draft.quickReplies.length < QUICK_REPLY_MAX && (
            <Btn
              variant='ghost'
              size='small'
              icon='plus'
              lbl={t('settings.messenger.replies.addQuick')}
              className='justify-self-start'
              onClick={() => setField('quickReplies', [...draft.quickReplies, ''])}
              disabled={loading}
            />
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend className='text-sm font-medium text-gray-900'>{t('settings.messenger.replies.links')}</legend>
        <p className='mt-0.5 text-xs text-gray-500'>{t('settings.messenger.replies.linksHint', { count: String(BUTTONS_MAX) })}</p>
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
                placeholder={t('settings.messenger.replies.buttonText')}
                aria-label={t('settings.messenger.replies.buttonTextLabel', { n: String(i + 1) })}
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
                aria-label={t('settings.messenger.replies.buttonUrlLabel', { n: String(i + 1) })}
                className='rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
              />
            </div>
          ))}
          {draft.buttons.length < BUTTONS_MAX && (
            <Btn
              variant='ghost'
              size='small'
              icon='plus'
              lbl={t('settings.messenger.replies.addButton')}
              className='justify-self-start'
              onClick={() => setField('buttons', [...draft.buttons, { title: '', url: '' }])}
              disabled={loading}
            />
          )}
        </div>
      </fieldset>

      <div>
        <label htmlFor='sr-attachment' className='block text-sm font-medium text-gray-900'>
          {t('settings.messenger.replies.attachmentUrl')}
        </label>
        <p className='mt-0.5 text-xs text-gray-500'>
          {t('settings.messenger.replies.attachmentHint')}
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
            aria-label={t('settings.messenger.replies.attachmentType')}
            className='rounded-md border border-gray-200 bg-white py-1.5 ps-2 pe-7 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary'
          >
            <option value='file'>{t('settings.messenger.replies.type.file')}</option>
            <option value='image'>{t('settings.messenger.replies.type.image')}</option>
            <option value='video'>{t('settings.messenger.replies.type.video')}</option>
            <option value='audio'>{t('settings.messenger.replies.type.audio')}</option>
          </select>
        </div>
      </div>

      {error && (
        <p role='alert' className='text-sm text-error-text'>
          {error}
        </p>
      )}

      <div className='flex gap-2'>
        <Btn lbl={loading ? t('settings.messenger.replies.saving') : t('settings.messenger.replies.save')} onClick={onSave} disabled={loading} />
        <Btn variant='ghost' lbl={t('settings.messenger.replies.cancel')} onClick={onCancel} disabled={loading} />
      </div>
    </div>
  )
}
