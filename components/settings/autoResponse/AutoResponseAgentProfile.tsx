'use client'

import { useId } from 'react'
import Icon from '@/lib/Icon'
import { HoverTooltip } from '@/components/ui/HoverTooltip'
import { useT } from '@/lib/i18n/I18nProvider'
import { untranslatedAttrs } from '@/lib/i18n/config'
import { AGENT_PROFILE_LIMITS as L, type AgentTone } from '@/lib/inbox/autoresponse/conversational/agentProfile'
import AutoResponseTextField from './AutoResponseTextField'
import AgentToneChips from './AgentToneChips'
import AgentFaqEditor from './AgentFaqEditor'

/**
 * The Smart Agent's personality and ready answers: greeting, persona, tone, FAQ
 * and the topics a person must handle. Shown only to an agency on the
 * conversational agent (IRE_CONVERSATIONAL_AGENCY_IDS); see the page.
 *
 * Like the rest of the Smart Agent's own configuration it is not localized (owner
 * order, lib/i18n/messages/he/admin/autoResponse.ts) and renders inside a declared
 * Hebrew region. Every control is an existing pattern of this form: the labelled
 * text field, the selected-ring chip, the outline button, the hover tooltip.
 * The tone row and the FAQ list live in their own files (AgentToneChips,
 * AgentFaqEditor).
 */

export type AgentProfileDraft = {
  greeting: string
  persona: string
  tone: AgentTone | ''
  faq: { question: string; answer: string }[]
  /** One topic per line. */
  escalationTopics: string
}

const PERSONAL_NOTE = 'בשיחה אישית עם חבר הוא לא משתמש בברכה ובטון העסקי.'

export default function AutoResponseAgentProfile({ value, onChange }: { value: AgentProfileDraft; onChange: (next: AgentProfileDraft) => void }) {
  const t = useT()
  const hebrew = untranslatedAttrs(t.locale)
  const greetingId = useId()
  const personaId = useId()
  const topicsId = useId()
  const set = <K extends keyof AgentProfileDraft>(key: K, v: AgentProfileDraft[K]) => onChange({ ...value, [key]: v })

  return (
    <section className='mt-5.5 border-t border-gray-200 pt-5.5' {...hebrew}>
      <h2 className='text-base font-semibold text-ink'>אישיות הסוכן ותשובות מוכנות</h2>
      {/*
        A flex row, not a <p>: Icon renders a <div>, which the HTML parser
        would hoist out of a paragraph (and break hydration).
      */}
      <div className='mt-1.5 flex items-center gap-1.5 text-sm leading-relaxed text-gray-600'>
        <p>לא חובה. מה שתכתבו כאן הסוכן מכיר בכל שיחה, בנוסף לתיאור העסק.</p>
        <HoverTooltip
          label={PERSONAL_NOTE}
          content={PERSONAL_NOTE}
          className='inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-primary'
        >
          <Icon type='reg' name='info' className='size-3.5 bg-gray-400' />
        </HoverTooltip>
      </div>

      <div className='mt-4 flex flex-col gap-5'>
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

        <AgentToneChips value={value.tone} onChange={(tone) => set('tone', tone)} />

        <AgentFaqEditor value={value.faq} onChange={(faq) => set('faq', faq)} />

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
