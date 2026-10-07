/**
 * The starting point for an agency that has never had a questionnaire.
 *
 * An honest, incomplete draft. It has sensible messages the owner will rarely
 * change (ending, handoff, attempts, abandonment window) and one first question
 * whose answers the owner fills in. It does not pass the publish check until
 * they do, by design: nothing invented is ever sent to a customer.
 *
 * The opening is written once, here. An agency name can carry punctuation the
 * send path would rewrite ("Demo — Yuton"), so it is cleaned BEFORE it becomes
 * the owner's text. After that the opening is the owner's, and nothing changes
 * it silently.
 */
import { hasCustomerFacingDash } from '../../customerFacingText'
import type { QuestionnaireDefinition } from '../definition'
import { QUESTIONNAIRE_SCHEMA_VERSION } from '../definition'

const DASH_RUN = /\s*[-‐‑–—−]+\s*/g

/** The name as a customer should read it: no clause dashes, no stray spaces. */
export function cleanBusinessName(businessName: string | null): string {
  const name = (businessName ?? '').replace(DASH_RUN, ' ').replace(/\s+/g, ' ').trim()
  return name && !hasCustomerFacingDash(name) ? name : ''
}

export function openingFor(businessName: string | null): string {
  const name = cleanBusinessName(businessName)
  const intro = 'כדי שנוכל לעזור, נשאל כמה שאלות קצרות.'
  if (!name) return `היי 👋 תודה שפניתם אלינו.\n\n${intro}`
  // "ל־Perfect Picture", the house style for a Latin name; "לסלון דנה" for a Hebrew one.
  const to = /^[֐-׿]/.test(name) ? `ל${name}` : `ל־${name}`
  return `היי 👋 תודה שפניתם ${to}.\n\n${intro}`
}

export function emptyQuestionnaire(businessName: string | null): QuestionnaireDefinition {
  return {
    schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION,
    revision: 1,
    language: 'he',
    welcome: openingFor(businessName),
    closing: 'מעולה, קיבלנו את הפרטים 🙏\n\nנחזור אליכם בהקדם.',
    handoff: 'תודה! העברנו את השיחה לצוות, ונחזור אליכם כאן.',
    summaryTitle: 'שאלון וואטסאפ הושלם',
    maxInvalidAttempts: 2,
    expireAfterHours: 24,
    steps: [
      {
        id: 'request_type',
        type: 'choice',
        label: 'סוג הפנייה',
        prompt: 'במה נוכל לעזור?',
        options: [
          { id: 'option_1', label: '' },
          { id: 'option_2', label: '' },
        ],
      },
    ],
  } as QuestionnaireDefinition
}
