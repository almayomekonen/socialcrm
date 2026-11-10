/**
 * The owner's structured agent profile: greeting, persona, tone, FAQ and the
 * topics that need a person. Stored per (agencyId, channel) in
 * `auto_response_settings."agentProfile"` (jsonb, nullable). Pure: parse,
 * validate, format. Never derived by a model: these are the owner's own words.
 *
 * The business description and the extra instructions stay where they always
 * were (`guidance`, `agentInstructions`); this profile adds to them and never
 * replaces them, so every existing configuration keeps working unchanged.
 *
 * Industry-neutral by construction: nothing here names a trade or a business.
 */
import { z } from 'zod'

export const AGENT_TONES = ['warm', 'professional', 'friendly', 'formal'] as const
export type AgentTone = (typeof AGENT_TONES)[number]

export const AGENT_PROFILE_LIMITS = {
  greeting: 200,
  persona: 600,
  faqItems: 20,
  faqQuestion: 200,
  faqAnswer: 600,
  escalationItems: 15,
  escalationTopic: 120,
} as const

export type FaqItem = { question: string; answer: string }
export type AgentProfile = {
  greeting: string | null
  persona: string | null
  tone: AgentTone | null
  faq: FaqItem[]
  escalationTopics: string[]
}

export const EMPTY_AGENT_PROFILE: AgentProfile = { greeting: null, persona: null, tone: null, faq: [], escalationTopics: [] }

/** One line of owner text: no control characters, collapsed whitespace, trimmed, capped. */
function clean(v: unknown, max: number, opts: { multiline?: boolean } = {}): string | null {
  if (typeof v !== 'string') return null
  // eslint-disable-next-line no-control-regex
  let t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
  t = opts.multiline ? t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : t.replace(/\s+/g, ' ')
  t = t.trim()
  return t ? [...t].slice(0, max).join('') : null
}

const RawProfile = z
  .object({
    greeting: z.unknown().optional(),
    persona: z.unknown().optional(),
    tone: z.unknown().optional(),
    faq: z.array(z.unknown()).optional(),
    escalationTopics: z.array(z.unknown()).optional(),
  })
  .passthrough()

/**
 * Accepts anything (a stored row or a form submission) and returns a valid
 * profile. Invalid pieces are dropped, never guessed: a FAQ entry without both a
 * question and an answer is not an entry.
 */
export function normalizeAgentProfile(raw: unknown): AgentProfile {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return { ...EMPTY_AGENT_PROFILE }
    }
  }
  const parsed = RawProfile.safeParse(value ?? {})
  if (!parsed.success) return { ...EMPTY_AGENT_PROFILE }
  const p = parsed.data
  const L = AGENT_PROFILE_LIMITS
  const faq: FaqItem[] = []
  for (const item of p.faq ?? []) {
    if (faq.length >= L.faqItems) break
    const r = (item ?? {}) as Record<string, unknown>
    const question = clean(r.question, L.faqQuestion)
    const answer = clean(r.answer, L.faqAnswer, { multiline: true })
    if (question && answer) faq.push({ question, answer })
  }
  const escalationTopics: string[] = []
  for (const t of p.escalationTopics ?? []) {
    if (escalationTopics.length >= L.escalationItems) break
    const topic = clean(t, L.escalationTopic)
    if (topic && !escalationTopics.includes(topic)) escalationTopics.push(topic)
  }
  const tone = typeof p.tone === 'string' && (AGENT_TONES as readonly string[]).includes(p.tone) ? (p.tone as AgentTone) : null
  return {
    greeting: clean(p.greeting, L.greeting),
    persona: clean(p.persona, L.persona, { multiline: true }),
    tone,
    faq,
    escalationTopics,
  }
}

export function isEmptyAgentProfile(p: AgentProfile): boolean {
  return !p.greeting && !p.persona && !p.tone && p.faq.length === 0 && p.escalationTopics.length === 0
}

/** What is stored: null for an empty profile, so an untouched row stays NULL. */
export function storableAgentProfile(p: AgentProfile): AgentProfile | null {
  return isEmptyAgentProfile(p) ? null : p
}

const TONE_LINE: Record<AgentTone, string> = {
  warm: 'חם, אדיב ומקצועי',
  professional: 'מקצועי וענייני',
  friendly: 'קליל וחברי',
  formal: 'רשמי ומנומס',
}

/** The FAQ as quotable facts: owner-stated answers may license a price or a process claim. */
export function agentProfileGroundedFacts(p: AgentProfile): string | null {
  if (!p.faq.length) return null
  return p.faq.map((f) => `${f.question}\n${f.answer}`).join('\n')
}

/** Prompt block. Null when the owner configured nothing. */
export function formatAgentProfileBlock(p: AgentProfile): string | null {
  if (isEmptyAgentProfile(p)) return null
  const lines = ['פרופיל הסוכן, כפי שבעל/ת העסק קבע/ה:']
  if (p.persona) lines.push(`אישיות ודרך דיבור בשם העסק: ${p.persona}`)
  if (p.tone) lines.push(`טון מועדף בשיחות עסקיות: ${TONE_LINE[p.tone]}. בשיחה אישית מתאימים את עצמך לאדם, לא לטון העסקי.`)
  if (p.faq.length) {
    lines.push('שאלות נפוצות ותשובות מאומתות של העסק (מותר לצטט את התשובה, אסור להוסיף עליה):')
    for (const f of p.faq) lines.push(`ש: ${f.question}\nת: ${f.answer}`)
  }
  if (p.escalationTopics.length) {
    lines.push(
      `נושאים שבעל/ת העסק רוצה שאדם יטפל בהם: ${p.escalationTopics.join('; ')}.`,
      'אם הלקוח מעלה אחד מהם: אל תענה/י על התוכן בעצמך וסמן/י escalationTopic=true. המערכת עצמה מעבירה את השיחה לאדם; אל תבטיח/י שמישהו יחזור.',
    )
  }
  return lines.join('\n')
}
