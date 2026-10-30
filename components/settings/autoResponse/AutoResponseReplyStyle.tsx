'use client'

import AutoResponseTextField from './AutoResponseTextField'
import { useT } from '@/lib/i18n/I18nProvider'
import { untranslatedAttrs } from '@/lib/i18n/config'

/**
 * "סגנון התשובה" — the whole of how a reply is produced.
 *
 * Extracted because `AutoResponseSettingsForm.tsx` crossed the 350-line hard
 * limit when the single-description flow, the inline business name, the
 * unsupported-request notice and the advanced section landed on it
 * (architecture-rules §1, §5). The markup moved intact; this component renders
 * and reports, it holds no state of its own beyond the advanced disclosure.
 *
 * The section owns one idea: given a chosen reply style, what does the owner
 * need to write. Everything about WHEN a reply goes out — the switches, the
 * delay, the cap — stays on the form.
 *
 * LANGUAGE. The reply-mode choice, the business name and the fixed message are
 * product chrome and follow the interface language. The Smart Agent's own
 * configuration — the description and advanced-instruction fields (their
 * labels, hints and example prompts) and the AI-derived "not performed" list —
 * is AI configuration, out of scope by owner order: it stays Hebrew inside a
 * declared Hebrew region (`untranslatedAttrs`).
 */
type Props = {
  replyMode: 'ai' | 'fixed'
  onReplyMode: (mode: 'ai' | 'fixed') => void

  /** The one description a Smart Agent owner writes. */
  guidance: string
  onGuidance: (value: string) => void

  /** Advanced, collapsed by default. Most owners never open it. */
  agentInstructions: string
  onAgentInstructions: (value: string) => void
  advancedOpen: boolean
  onToggleAdvanced: () => void

  /** Fixed Message, unchanged. */
  fixedBody: string
  onFixedBody: (value: string) => void
  fixedBodyError?: string

  /** Asked inline only when the account has no name yet. */
  businessName: string
  onBusinessName: (value: string) => void
  needsBusinessName: boolean
  businessNameError?: string

  /** Things the description asked for that the agent cannot actually perform. */
  unsupported: string[]

  bodyId: string
  instructionsId: string
  nameId: string
  maxLength: number
}

export default function AutoResponseReplyStyle({
  replyMode,
  onReplyMode,
  guidance,
  onGuidance,
  agentInstructions,
  onAgentInstructions,
  advancedOpen,
  onToggleAdvanced,
  fixedBody,
  onFixedBody,
  fixedBodyError,
  businessName,
  onBusinessName,
  needsBusinessName,
  businessNameError,
  unsupported,
  bodyId,
  instructionsId,
  nameId,
  maxLength,
}: Props) {
  const t = useT()
  const hebrew = untranslatedAttrs(t.locale)
  return (
      <section className='mt-5.5 border-t border-gray-200 pt-5.5'>
        <h2 className='text-base font-semibold text-ink'>{t('admin.autoResponse.style.title')}</h2>
        <p className='mt-1.5 text-sm leading-relaxed text-gray-600'>{t('admin.autoResponse.style.intro')}</p>

        {replyMode === 'ai' && needsBusinessName && (
          <div className='mt-4 max-w-md'>
            <label htmlFor={nameId} className='text-sm font-semibold text-gray-700'>
              {t('admin.autoResponse.style.businessName')}
            </label>
            <p className='mt-0.5 text-xs text-gray-500'>{t('admin.autoResponse.style.businessNameHint')}</p>
            <input
              id={nameId}
              type='text'
              value={businessName}
              onChange={(e) => onBusinessName(e.target.value)}
              maxLength={120}
              aria-invalid={!!businessNameError}
              aria-describedby={businessNameError ? `${nameId}-error` : undefined}
              placeholder={t('admin.autoResponse.style.businessNamePlaceholder')}
              className='mt-2 block w-full rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:outline-2 focus:outline-offset-0 focus:outline-primary aria-invalid:border-red-500'
            />
            {businessNameError && (
              <p id={`${nameId}-error`} role='alert' className='mt-1 text-sm text-red-600'>
                {businessNameError}
              </p>
            )}
          </div>
        )}

        <div className='mt-4 grid gap-x-3 gap-y-4 sm:grid-cols-2'>
          <label className='flex cursor-pointer flex-col gap-1.5 rounded-lg border border-gray-200 bg-white px-4.5 py-3.5 transition-colors hover:border-gray-300 has-checked:border-solid has-checked:ring-1 has-checked:ring-solid'>
            <span className='flex items-center justify-between gap-2.5'>
              <span className='text-md font-semibold text-ink'>{t('admin.autoResponse.style.ai')}</span>
              <input
                type='radio'
                name='replyMode'
                className='size-4 accent-solid'
                checked={replyMode === 'ai'}
                onChange={() => onReplyMode('ai')}
              />
            </span>
            <span className='text-sm leading-relaxed text-gray-600'>{t('admin.autoResponse.style.aiHint')}</span>
          </label>

          <label className='flex cursor-pointer flex-col gap-1.5 rounded-lg border border-gray-200 bg-white px-4.5 py-3.5 transition-colors hover:border-gray-300 has-checked:border-solid has-checked:ring-1 has-checked:ring-solid'>
            <span className='flex items-center justify-between gap-2.5'>
              <span className='text-md font-semibold text-ink'>{t('admin.autoResponse.style.fixed')}</span>
              <input
                type='radio'
                name='replyMode'
                className='size-4 accent-solid'
                checked={replyMode === 'fixed'}
                onChange={() => onReplyMode('fixed')}
              />
            </span>
            <span className='text-sm leading-relaxed text-gray-600'>{t('admin.autoResponse.style.fixedHint')}</span>
          </label>

          {/*
            ONE box for Smart Agent. The owner describes the business in
            their own words and the system derives the structure on save —
            they never see model instructions, stages, schemas or field lists.
            Fixed Message keeps its single verbatim box, unchanged. Each sits
            in the column of its own radio, which ties the field to the
            option without drawing a container around them.
          */}
          {replyMode === 'ai' ? (
            <div className='flex flex-col gap-4 sm:col-start-1' {...hebrew}>
              <AutoResponseTextField
                id={bodyId}
                label='ספרו לסוכן על העסק ומה תרצו שיעשה'
                hint='כתבו מה העסק מציע, מידע שחשוב ללקוחות לדעת ואיך תרצו שהסוכן יעזור. הסוכן ישתמש במידע כדי לענות ולנהל שיחה בשם העסק.'
                value={guidance}
                onChange={(v) => onGuidance(v)}
                maxLength={maxLength}
                sent={false}
                rows={6}
                placeholder='אנחנו מוסך בחולון, פתוחים א׳–ה׳ 8:00–17:00. עושים טיפולים ותיקונים. ברר מה הבעיה ברכב, דגם ושנתון, ואסוף פרטים כדי שנחזור ללקוח לתיאום.'
              />
            </div>
          ) : (
            <div className='sm:col-start-2'>
              <AutoResponseTextField
                id={bodyId}
                label={t('admin.autoResponse.style.fixedLabel')}
                hint={t('admin.autoResponse.style.fixedFieldHint')}
                value={fixedBody}
                onChange={(v) => onFixedBody(v)}
                maxLength={maxLength}
                sent
                error={fixedBodyError}
                placeholder={t('admin.autoResponse.style.fixedPlaceholder')}
                translated
              />
            </div>
          )}
        </div>

        {/*
          What the owner asked for that the agent cannot actually perform.
          Surfaced after a save because a description saying "book the
          appointment" is a reasonable thing to write and a silent
          downgrade would be worse than saying so plainly.
        */}
        {replyMode === 'ai' && unsupported.length > 0 && (
          <div className='mt-4 max-w-2xl rounded-lg border border-gray-200 bg-white px-4.5 py-3.5' {...hebrew}>
            <p className='text-sm font-semibold text-ink'>שני דברים שכדאי לדעת</p>
            <p className='mt-1 text-sm leading-relaxed text-gray-600'>
              הסוכן לא מבצע את הפעולות האלה בפועל. הוא יאסוף את הפרטים ויגיד ללקוח שאתם חוזרים אליו:
            </p>
            <ul className='mt-2 list-disc space-y-1 pr-5 text-sm text-gray-600'>
              {unsupported.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        )}

        {replyMode === 'ai' && (
          <div className='mt-5'>
            <button
              type='button'
              onClick={() => onToggleAdvanced()}
              aria-expanded={advancedOpen}
              className='text-sm font-medium text-gray-700 underline underline-offset-2'
            >
              {advancedOpen ? t('admin.autoResponse.style.advancedHide') : t('admin.autoResponse.style.advancedShow')}
            </button>
            {advancedOpen && (
              <div className='mt-3.5 max-w-2xl' {...hebrew}>
                <AutoResponseTextField
                  id={instructionsId}
                  label='הנחיות נוספות לסוכן'
                  hint='לא חובה. רוב העסקים לא צריכים את זה'
                  value={agentInstructions}
                  onChange={(v) => onAgentInstructions(v)}
                  maxLength={maxLength}
                  sent={false}
                  rows={3}
                  placeholder='למשל: לפנות בלשון רבים. אם הלקוח מבקש מחיר, להעביר אלינו מיד.'
                />
              </div>
            )}
          </div>
        )}
      </section>
  )
}
