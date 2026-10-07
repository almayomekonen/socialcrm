/**
 * Question and option identity. Assigned here, server-side, never by a browser.
 *
 * Every stored answer, pinned session, CRM summary and condition refers to ids,
 * so identity must survive every edit that is not a deliberate act:
 *
 *   · an existing id is kept — rewording "מה תאריך האירוע?" to "באיזה תאריך
 *     האירוע?" is the same question;
 *   · no id means a new entity — a copy, or a question added — and gets a fresh
 *     random id that has never existed in this questionnaire;
 *   · an id the current draft does not contain is refused. A client cannot mint,
 *     forge or resurrect an identity; deleting and recreating is a new id.
 *
 * Existing semantic ids ("event_type", "wedding") are kept forever; only new
 * entities get generated ones. Array order is the stable order.
 */
import { randomBytes } from 'node:crypto'
import type { QuestionnaireDefinition } from '../definition'
import type { BuilderQuestionnaire, IdentifiedQuestionnaire } from './model'

export type IdError = { code: 'unknown_id' | 'duplicate_id'; id: string; questionId?: string }

function fresh(prefix: 'q' | 'o', taken: Set<string>): string {
  for (;;) {
    const id = `${prefix}_${BigInt('0x' + randomBytes(6).toString('hex')).toString(36).padStart(8, '0').slice(-8)}`
    if (!taken.has(id)) {
      taken.add(id)
      return id
    }
  }
}

export function assignIds(
  previous: QuestionnaireDefinition | null,
  incoming: BuilderQuestionnaire,
): { ok: true; questionnaire: IdentifiedQuestionnaire } | { ok: false; error: IdError } {
  const knownQuestions = new Set((previous?.steps ?? []).map((s) => s.id))
  const knownOptions = new Map<string, Set<string>>()
  for (const s of previous?.steps ?? []) {
    if (s.type === 'choice') knownOptions.set(s.id, new Set(s.options.map((o) => o.id)))
  }

  const takenQuestions = new Set(knownQuestions)
  const seen = new Set<string>()
  for (const q of incoming.questions) {
    if (!q.id) continue
    if (!knownQuestions.has(q.id)) return { ok: false, error: { code: 'unknown_id', id: q.id } }
    if (seen.has(q.id)) return { ok: false, error: { code: 'duplicate_id', id: q.id } }
    seen.add(q.id)
  }

  const questions: IdentifiedQuestionnaire['questions'] = []
  for (const q of incoming.questions) {
    const id = q.id ?? fresh('q', takenQuestions)
    if (q.answer.kind !== 'single_choice' && q.answer.kind !== 'multi_choice') {
      questions.push({ ...q, id, answer: q.answer })
      continue
    }
    const allowed = q.id ? (knownOptions.get(q.id) ?? new Set<string>()) : new Set<string>()
    const takenOptions = new Set(allowed)
    const seenOptions = new Set<string>()
    const options = []
    for (const o of q.answer.options) {
      if (o.id) {
        if (!allowed.has(o.id)) return { ok: false, error: { code: 'unknown_id', id: o.id, questionId: id } }
        if (seenOptions.has(o.id)) return { ok: false, error: { code: 'duplicate_id', id: o.id, questionId: id } }
        seenOptions.add(o.id)
      }
    }
    for (const o of q.answer.options) options.push({ ...o, id: o.id ?? fresh('o', takenOptions) })
    questions.push({ ...q, id, answer: { kind: q.answer.kind, options } })
  }
  return { ok: true, questionnaire: { ...incoming, questions } }
}
