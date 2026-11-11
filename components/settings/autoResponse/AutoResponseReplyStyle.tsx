'use client'

import Icon from '@/lib/Icon'
import AutoResponseTextField from './AutoResponseTextField'
import { useT } from '@/lib/i18n/I18nProvider'
import { untranslatedAttrs } from '@/lib/i18n/config'

/**
 * The settings of the chosen response method: the AI's business name,
 * description, advanced instructions and "not performed" notice, or the fixed
 * message. The method itself is picked in ResponseMethodSelector (it replaced
 * the old "סגנון התשובה" radios); this component renders and reports.
 *
 * The section owns one idea: given the chosen method, what does the owner need
 * to write. Everything about WHEN a reply goes out — the switches, the
 * delay, the cap — stays on the form. Every field spans the content column, so
 * the page reads down one edge.
 *
 * LANGUAGE. The business name and the fixed message are
 * product chrome and follow the interface language. The Smart Agent's own
 * configuration — the description and advanced-instruction fields (their
 * labels, hints and example prompts) and the AI-derived "not performed" list —
 * is AI configuration, out of scope by owner order: it stays Hebrew inside a
 * declared Hebrew region (`untranslatedAttrs`).
 */
type Props = {
  /** 'ai' or 'fixed' — the method's fields (the questionnaire has none here). */
  replyMode: 'ai' | 'fixed'

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
  advancedId: string
  maxLength: number
}

export default function AutoResponseReplyFields({
  replyMode,
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
  advancedId,
}: Props) {
  const t = useT()
  const hebrew = untranslatedAttrs(t.locale)

  if (replyMode === 'fixed') {
    return (
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
    )
  }

  return (
    <div className='flex flex-col gap-5'>
      {needsBusinessName && (
        <div>
          <label htmlFor={nameId} className='text-sm font-semibold text-gray-700'>
            {t('admin.autoResponse.style.businessName')}
          </label>
          <p className='mt-0.5 text-xs leading-relaxed text-gray-500'>{t('admin.autoResponse.style.businessNameHint')}</p>
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

      {/*
        ONE box for Smart Agent. The owner describes the business in their own
        words and the system derives the structure on save — they never see
        model instructions, stages, schemas or field lists.
      */}
      <div {...hebrew}>
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

      {/*
        What the owner asked for that the agent cannot actually perform.
        Surfaced after a save because a description saying "book the
        appointment" is a reasonable thing to write and a silent downgrade
        would be worse than saying so plainly.
      */}
      {unsupported.length > 0 && (
        <div className='rounded-lg border border-gray-200 bg-white px-4.5 py-3.5' {...hebrew}>
          <p className='text-sm font-semibold text-ink'>שני דברים שכדאי לדעת</p>
          <p className='mt-1 text-sm leading-relaxed text-gray-600'>
            הסוכן לא מבצע את הפעולות האלה בפועל. הוא יאסוף את הפרטים ויגיד ללקוח שאתם חוזרים אליו:
          </p>
          <ul className='mt-2 list-disc space-y-1 ps-5 text-sm text-gray-600'>
            {unsupported.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <button
          type='button'
          onClick={() => onToggleAdvanced()}
          aria-expanded={advancedOpen}
          aria-controls={advancedId}
          className='flex w-fit items-center gap-1.5 rounded text-sm font-medium text-gray-700 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
        >
          <Icon
            type='reg'
            name='chevron-down'
            className={`size-3 bg-gray-500 transition-transform duration-200 motion-reduce:transition-none ${advancedOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
          {t('admin.autoResponse.style.advancedShow')}
        </button>
        {/* The Hebrew region is declared only while there is Hebrew in it. */}
        <div id={advancedId} hidden={!advancedOpen} className='mt-3.5' {...(advancedOpen ? hebrew : {})}>
          {advancedOpen && (
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
          )}
        </div>
      </div>
    </div>
  )
}
