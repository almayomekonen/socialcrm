'use client'

import { useId } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import { untranslatedAttrs } from '@/lib/i18n/config'
import { AGENT_PROFILE_LIMITS as L, type AgentTone } from '@/lib/inbox/autoresponse/conversational/agentProfile'
import AutoResponseTextField from './AutoResponseTextField'

/**
 * The Smart Agent's personality and ready answers: greeting, persona, tone, FAQ
 * and the topics a person must handle. Shown only to an agency on the
 * conversational agent (IRE_CONVERSATIONAL_AGENCY_IDS); see the page.
 *
 * Like the rest of the Smart Agent's own configuration it is not localized (owner
 * order, lib/i18n/messages/he/admin/autoResponse.ts) and renders inside a declared
 * Hebrew region. Every control is an existing pattern of this form: the labelled
 * text field, the radio card, the text-link button. Nothing new is drawn.
 */

export type AgentProfileDraft = {
  greeting: string
  persona: string
  tone: AgentTone | ''
  faq: { question: string; answer: string }[]
  /** One topic per line. */
  escalationTopics: string
}

const TONES: { value: AgentTone | ''; label: string; hint: string }[] = [
  { value: '', label: 'לפי הלקוח', hint: 'הסוכן מתאים את עצמו לאופן שבו הלקוח כותב' },
  { value: 'warm', label: 'חם ומקצועי', hint: 'אדיב, נעים, עם יחס אישי' },
  { value: 'professional', label: 'מקצועי וענייני', hint: 'קצר, ברור, בלי סלנג' },
  { value: 'friendly', label: 'קליל וחברי', hint: 'שפה יומיומית ומשוחררת' },
  { value: 'formal', label: 'רשמי ומנומס', hint: 'פנייה מכובדת, בלי קיצורים' },
]

const linkButton = 'text-sm font-medium text-gray-700 underline underline-offset-2'
const inputClass =
  'mt-2 block w-full rounded-md border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:outline-2 focus:outline-offset-0 focus:outline-primary'

export default function AutoResponseAgentProfile({ value, onChange }: { value: AgentProfileDraft; onChange: (next: AgentProfileDraft) => void }) {
  const t = useT()
  const hebrew = untranslatedAttrs(t.locale)
  const greetingId = useId()
  const personaId = useId()
  const topicsId = useId()
  const faqId = useId()
  const set = <K extends keyof AgentProfileDraft>(key: K, v: AgentProfileDraft[K]) => onChange({ ...value, [key]: v })
  const setFaq = (i: number, patch: Partial<{ question: string; answer: string }>) =>
    set('faq', value.faq.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  return (
    <section className='mt-5.5 border-t border-gray-200 pt-5.5' {...hebrew}>
      <h2 className='text-base font-semibold text-ink'>אישיות הסוכן ותשובות מוכנות</h2>
      <p className='mt-1.5 max-w-2xl text-sm leading-relaxed text-gray-600'>
        לא חובה. מה שתכתבו כאן הסוכן מכיר בכל שיחה, בנוסף לתיאור העסק. בשיחה אישית עם חבר הוא לא משתמש בברכה ובטון העסקי.
      </p>

      <div className='mt-4 flex max-w-2xl flex-col gap-5'>
        <AutoResponseTextField
          id={greetingId}
          label='ברכת פתיחה'
          hint='נשלחת בתחילת שיחה עסקית חדשה, מילה במילה'
          value={value.greeting}
          onChange={(v) => set('greeting', v)}
          maxLength={L.greeting}
          sent
          rows={2}
          placeholder='למשל: היי, ברוכים הבאים! שמחים שפניתם 😊'
        />

        <AutoResponseTextField
          id={personaId}
          label='האישיות של הסוכן'
          hint='איך הוא מדבר בשם העסק'
          value={value.persona}
          onChange={(v) => set('persona', v)}
          maxLength={L.persona}
          sent={false}
          rows={3}
          placeholder='למשל: נעים וסבלני, מסביר בפשטות, לא לוחץ על הלקוח.'
        />

        <fieldset>
          <legend className='text-sm font-semibold text-gray-700'>טון מועדף בשיחות עסקיות</legend>
          <div className='mt-3.5 grid gap-x-3 gap-y-3 sm:grid-cols-2'>
            {TONES.map((tone) => (
              <label
                key={tone.value || 'auto'}
                className='flex cursor-pointer flex-col gap-1.5 rounded-lg border border-gray-200 bg-white px-4.5 py-3.5 transition-colors hover:border-gray-300 has-checked:border-solid has-checked:ring-1 has-checked:ring-solid'
              >
                <span className='flex items-center justify-between gap-2.5'>
                  <span className='text-md font-semibold text-ink'>{tone.label}</span>
                  <input type='radio' name='agentTone' className='size-4 accent-solid' checked={value.tone === tone.value} onChange={() => set('tone', tone.value)} />
                </span>
                <span className='text-sm leading-relaxed text-gray-600'>{tone.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <div className='flex items-baseline gap-2.5'>
            <h3 id={faqId} className='text-sm font-semibold text-gray-700'>
              שאלות נפוצות
            </h3>
            <p className='text-xs text-gray-500'>הסוכן עונה מהתשובות שלכם בלבד, ולא מוסיף עליהן</p>
          </div>
          <div className='mt-3.5 flex flex-col gap-4' aria-labelledby={faqId}>
            {value.faq.map((f, i) => (
              <div key={i} className='rounded-lg border border-gray-200 bg-white px-4.5 py-3.5'>
                <label className='text-sm font-medium text-gray-700' htmlFor={`${faqId}-q${i}`}>
                  שאלה {i + 1}
                </label>
                <input
                  id={`${faqId}-q${i}`}
                  type='text'
                  value={f.question}
                  maxLength={L.faqQuestion}
                  onChange={(e) => setFaq(i, { question: e.target.value })}
                  placeholder='למשל: כמה זמן מראש צריך להזמין?'
                  className={inputClass}
                />
                <label className='mt-3 block text-sm font-medium text-gray-700' htmlFor={`${faqId}-a${i}`}>
                  התשובה
                </label>
                <textarea
                  id={`${faqId}-a${i}`}
                  rows={2}
                  value={f.answer}
                  maxLength={L.faqAnswer}
                  onChange={(e) => setFaq(i, { answer: e.target.value })}
                  placeholder='למשל: מומלץ חודשיים מראש, ולפעמים יש מקום גם בהתראה קצרה.'
                  className={`${inputClass} resize-none leading-relaxed`}
                />
                <button type='button' className={`${linkButton} mt-2.5`} onClick={() => set('faq', value.faq.filter((_, j) => j !== i))}>
                  הסרת השאלה
                </button>
              </div>
            ))}
            {value.faq.length < L.faqItems && (
              <button type='button' className={`${linkButton} w-fit`} onClick={() => set('faq', [...value.faq, { question: '', answer: '' }])}>
                הוספת שאלה נפוצה
              </button>
            )}
          </div>
        </div>

        <AutoResponseTextField
          id={topicsId}
          label='נושאים שדורשים אדם'
          hint='נושא בכל שורה. כשלקוח מעלה אחד מהם, הסוכן לא עונה בעצמו ומעביר אליכם'
          value={value.escalationTopics}
          onChange={(v) => set('escalationTopics', v)}
          maxLength={L.escalationItems * (L.escalationTopic + 1)}
          sent={false}
          rows={3}
          placeholder={'למשל:\nביטול אירוע והחזר כספי\nתלונה על שירות'}
        />
      </div>
    </section>
  )
}

export function toAgentProfileDraft(p: { greeting: string | null; persona: string | null; tone: AgentTone | null; faq: { question: string; answer: string }[]; escalationTopics: string[] } | null): AgentProfileDraft {
  return {
    greeting: p?.greeting ?? '',
    persona: p?.persona ?? '',
    tone: p?.tone ?? '',
    faq: p?.faq.map((f) => ({ ...f })) ?? [],
    escalationTopics: (p?.escalationTopics ?? []).join('\n'),
  }
}

/** The draft as the action's input. Validation and caps are re-applied on the server. */
export function fromAgentProfileDraft(d: AgentProfileDraft) {
  return {
    greeting: d.greeting.trim() || null,
    persona: d.persona.trim() || null,
    tone: d.tone || null,
    faq: d.faq.map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })).filter((f) => f.question && f.answer),
    escalationTopics: d.escalationTopics
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  }
}
