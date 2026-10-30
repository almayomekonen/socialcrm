import type { Allowance } from './leakScan'
import { deriveEditorView } from '@/lib/inbox/autoresponse/questionnaire/builder/editorView'
import { optionsOf } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'
import type { BuilderQuestionnaire } from '@/lib/inbox/autoresponse/questionnaire/builder/model'
import { QUESTIONNAIRE } from './questionnaireEnv'

/**
 * What the questionnaire builder shows EXACTLY as written in every language
 * (leak-gate reason `verbatim-content`, Phase E5c): the questionnaire the
 * business wrote and sends on WhatsApp — the opening, every question's wording
 * and short name, the answers and their phrasings, the endings, the hand-off
 * message, the summary title — and the messages the PRODUCTION renderer builds
 * from it for the preview (the numbered menu and the rep hint included).
 * Inside a translated sentence ("Delete the question "סוג האירוע"") only the
 * quoted part is allowed.
 *
 * Derived from the fixture and the real renderer, so an allowance can only
 * name questionnaire content.
 */
export function contentOf(m: BuilderQuestionnaire): string[] {
  const view = deriveEditorView(m)
  const texts = [
    m.opening, m.endings.standard, ...m.endings.custom.map((e) => e.message), m.handoffMessage, m.summaryTitle,
    ...m.questions.flatMap((q) => [q.label, q.prompt, ...optionsOf(q).flatMap((o) => [o.label, ...o.phrasings]), q.messages?.notUnderstood ?? '']),
    view.opening ?? '', ...Object.values(view.messages), view.endings.standard, ...view.endings.custom,
  ]
  return [...new Set(texts.filter(Boolean))]
}

const CONTENT = contentOf(QUESTIONNAIRE)

export function content(...texts: string[]): Allowance[] {
  return texts.map((text) => {
    if (!CONTENT.includes(text)) throw new Error(`not questionnaire content: ${text}`)
    return { text, reason: 'verbatim-content' as const }
  })
}

const q = QUESTIONNAIRE.questions
const view = deriveEditorView(QUESTIONNAIRE)

/** Everything the list view shows of the fixture questionnaire (extra messages folded, no question focused). */
export const LIST_VIEW: Allowance[] = content(
  QUESTIONNAIRE.opening,
  QUESTIONNAIRE.endings.standard,
  QUESTIONNAIRE.endings.custom[0].message,
  ...q.flatMap((x) => [x.label, x.prompt]),
  ...q.flatMap((x) => optionsOf(x).flatMap((o) => [o.label, ...o.phrasings])),
  view.opening!,
)
