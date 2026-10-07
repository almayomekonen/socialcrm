/**
 * The starting point for an agency that has never had a questionnaire.
 *
 * An honest, incomplete draft: sensible messages the owner will rarely change
 * (ending, handoff, attempts, abandonment window) and no questions yet. It does
 * not pass the publish check until the owner adds a question — by design.
 */
import type { QuestionnaireDefinition } from '../definition'
import { QUESTIONNAIRE_SCHEMA_VERSION } from '../definition'

export function emptyQuestionnaire(businessName: string | null): QuestionnaireDefinition {
  const name = (businessName ?? '').trim()
  return {
    schemaVersion: QUESTIONNAIRE_SCHEMA_VERSION,
    revision: 1,
    language: 'he',
    welcome: name ? `היי 👋 תודה שפניתם ל${name}.` : 'היי 👋 תודה שפניתם אלינו.',
    closing: 'מעולה, קיבלנו את הפרטים 🙏\n\nנחזור אליכם בהקדם.',
    handoff: 'תודה! העברנו את השיחה לצוות, ונחזור אליכם כאן.',
    summaryTitle: 'שאלון וואטסאפ הושלם',
    maxInvalidAttempts: 2,
    expireAfterHours: 24,
    steps: [],
  } as QuestionnaireDefinition
}
