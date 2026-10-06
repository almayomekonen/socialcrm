/**
 * Reading what the customer sent, deterministically.
 *
 * Every function here is pure and total: given the same message it always
 * returns the same verdict, and an input it cannot read is reported as
 * unreadable rather than guessed at. Nothing in this file calls a model, and
 * nothing in it may learn to.
 *
 * The two command detectors are the system's existing ones, deliberately:
 * a customer who writes "תפסיקו" must mean the same thing to the questionnaire
 * as to the agent, and one vocabulary is the only way that stays true.
 */
import { detectOptOut } from '../optOutDetect'
import { isExplicitPersonRequest } from '../salesIntent'
import type { QuestionnaireChoiceStep } from './definition'
import { matchAliases, stepHasAliases } from './aliasMatch'

/** What kind of thing the customer sent, from inbox_messages.type. */
export type InboundKind = 'text' | 'voice' | 'media' | 'ignorable'

export function classifyInboundKind(type: string, text: string): InboundKind {
  if (type === 'audio') return 'voice'
  if (type === 'reaction' || type === 'system' || type === 'unknown') return 'ignorable'
  if (typeof text === 'string' && text.trim()) return 'text'
  // A tapped reply button / list row arrives with its title as text (see
  // parseWhatsappMessage) and is read above, as 'text', by its id. What is left
  // here is an interactive or template-button reply with no readable title.
  if (type === 'image' || type === 'document' || type === 'video' || type === 'sticker') return 'media'
  if (type === 'location' || type === 'contacts' || type === 'interactive' || type === 'button') return 'media'
  return 'ignorable'
}

export type QuestionnaireCommand = 'opt_out' | 'human' | 'restart' | 'decline' | null

/**
 * "Not interested", as the WHOLE message. Inside a questionnaire this means
 * "stop asking me", not "never message me again": it is not an opt-out and
 * records no compliance stop. Anything longer ("לא מעוניין בוידאו") is an answer
 * to read, not a command.
 */
const DECLINE = /^(?:תודה\s*,?\s*)?(?:לא|ממש לא)\s+(?:מעוניין|מעוניינת|מעוניינים|רלוונטי|רלוונטית)(?:\s*,?\s*תודה)?[.!]*$/

const RESTART_PATTERNS: RegExp[] = [
  /^התחלה מחדש$/,
  /^מהתחלה$/,
  /^מההתחלה$/,
  /^להתחיל מחדש$/,
  /^restart$/i,
  /^start over$/i,
]

/**
 * Priority is deliberate and not configurable: a customer asking us to stop
 * outranks everything, and asking for a person outranks continuing the script.
 * Restart is last because it is the only one that keeps the conversation going.
 */
export function detectCommand(text: string): QuestionnaireCommand {
  const raw = (text ?? '').trim()
  if (!raw) return null
  if (detectOptOut(raw)) return 'opt_out'
  if (isExplicitPersonRequest(raw) && !declinesPerson(normalizeForMatch(raw))) return 'human'
  const normalized = normalizeForMatch(raw)
  if (RESTART_PATTERNS.some((re) => re.test(normalized))) return 'restart'
  if (DECLINE.test(normalized)) return 'decline'
  return null
}

/**
 * "אני לא רוצה נציג", "בלי נציג", "לא צריך נציג": the word is there, the request
 * is not. Only a negation directly governing the person counts ("לא, נציג
 * בבקשה" still asks for one), so this can only ever keep a handoff that the
 * customer refused from happening, never suppress one they asked for in words
 * this does not list.
 */
const DECLINES_PERSON =
  /(?:^|\s)(?:לא|בלי|ללא|אין צורך)\s+(?:(?:רוצה|רוצים|צריך|צריכה|צריכים|מעוניין|מעוניינת|לדבר|עם|את)\s+){0,3}[בלה]?(?:נציג|בן אדם|בנאדם|אדם אמיתי)/

function declinesPerson(text: string): boolean {
  return DECLINES_PERSON.test(text)
}

/** Strip bidi marks, keycap decorations and repeated whitespace. */
export function normalizeForMatch(text: string): string {
  return (text ?? '')
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/️/g, '')
    .replace(/⃣/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Arabic-Indic and Extended Arabic-Indic digits to ASCII. */
function asciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0)
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660
    return String(code - base)
  })
}

/** `via: 'alias'`: read from the customer's own words, so the caller keeps them (aliasMatch.ts). */
export type ChoiceParse =
  | { ok: true; optionIds: string[]; via?: 'alias' }
  | { ok: false; reason: 'unreadable' | 'too_many' }

/**
 * A numbered menu answer: "2", "2.", "2)", "1,3", "1 3", or the option's own
 * label typed out. Every token must resolve, because a message like "2 ואולי 5"
 * is a person thinking out loud, not a selection, and guessing which half they
 * meant is exactly the behaviour this feature exists to avoid.
 *
 * A step whose options list aliases also reads a natural reply that names
 * exactly one option ("רק בערב אחרי העבודה"); see aliasMatch.ts.
 */
export function parseChoice(text: string, step: QuestionnaireChoiceStep): ChoiceParse {
  const normalized = asciiDigits(normalizeForMatch(text))
  if (!normalized) return { ok: false, reason: 'unreadable' }

  // Only a step whose options list aliases reads natural answers; every other
  // step keeps the numbered-menu rule above, unchanged.
  const numbered = parseNumbered(normalized.replace(MENU_WORD, ''), step)
  if (numbered.ok === false && numbered.reason === 'too_many') return numbered
  if (numbered.ok || !stepHasAliases(step)) return numbered
  // A question is not a selection, even when it names options: "מה ההבדל בין
  // סטילס לוידאו?" or "יש לי אישור?" must be asked again, never answered for them.
  if (/[?؟]/.test(normalized)) return { ok: false, reason: 'unreadable' }
  const ids = matchAliases(normalized, step)
  if (ids.length === 1 || (ids.length > 1 && step.multi === true)) return { ok: true, optionIds: ids, via: 'alias' }
  return { ok: false, reason: 'unreadable' }
}

/** "מספר 2", "אפשרות 2": the number is the answer. */
const MENU_WORD = /^(?:מספר|אפשרות|אופציה)\s+(?=\d)/

function parseNumbered(normalized: string, step: QuestionnaireChoiceStep): ChoiceParse {
  const labelMatch = matchLabel(normalized, step)
  if (labelMatch) return { ok: true, optionIds: [labelMatch] }

  const tokens = normalized.split(/[,،;/\s]+/).filter(Boolean)
  if (!tokens.length) return { ok: false, reason: 'unreadable' }

  const picked: string[] = []
  for (const token of tokens) {
    const digits = /^(\d{1,2})[.)]?$/.exec(token)
    if (!digits) return { ok: false, reason: 'unreadable' }
    const index = Number(digits[1])
    if (!Number.isFinite(index) || index < 1 || index > step.options.length) {
      return { ok: false, reason: 'unreadable' }
    }
    const id = step.options[index - 1].id
    if (!picked.includes(id)) picked.push(id)
  }

  if (!picked.length) return { ok: false, reason: 'unreadable' }
  if (picked.length > 1 && step.multi !== true) return { ok: false, reason: 'too_many' }
  return { ok: true, optionIds: picked }
}

function matchLabel(normalized: string, step: QuestionnaireChoiceStep): string | null {
  const candidate = normalized.toLowerCase()
  for (const option of step.options) {
    if (option.label.trim().toLowerCase() === candidate) return option.id
    // The menu line copied back, icon included, is still the label.
    if (option.icon && normalizeForMatch(`${option.label} ${option.icon}`).toLowerCase() === candidate) return option.id
  }
  return null
}

export type TextParse = { ok: true; value: string } | { ok: false; reason: 'unreadable' }

/** Free text: anything the customer actually wrote, capped so one message cannot flood a summary. */
export function parseFreeText(text: string): TextParse {
  const value = normalizeForMatch(text).slice(0, 300).trim()
  if (!value) return { ok: false, reason: 'unreadable' }
  return { ok: true, value }
}

/**
 * Several messages can arrive before we answer. For free text they are one
 * answer split across bubbles, so they are joined in arrival order; the newest
 * message alone would silently drop the first half of "בתל אביב" / "או בחיפה".
 */
export function joinTextInputs(texts: readonly string[]): string {
  return texts
    .map((t) => normalizeForMatch(t))
    .filter(Boolean)
    .join(' ')
    .slice(0, 300)
    .trim()
}
