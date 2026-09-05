/**
 * SAMPLE DATA FOR THE UI PROTOTYPE. NOT BUSINESS FACTS.
 *
 * Every name, count and duration in this file is invented so the new agent
 * surface can be reviewed with realistic-looking content. Nothing here is read
 * from the CRM, and nothing here may ever be presented to a customer as their
 * own data — care-charter Law 1 ("the assistant never invents a business fact")
 * is the reason the surface carries a visible preview notice while this module
 * is its source of answers.
 *
 * WHEN THE REAL AGENT LANDS: delete this file. The turn/card types are the
 * contract the view components render, so the backend can produce the same
 * shapes and no presentation component has to change.
 *
 * Pure data + one pure lookup: no JSX, no hooks, no client runtime.
 */

/** A card rendered beneath an agent answer. Presentation only — see AgentCards. */
export type AgentCard =
  | {
      kind: 'lead'
      id: string
      /** Lead name. */
      name: string
      /** Status word, e.g. "ליד חדש". */
      status: string
      /** What the lead is waiting for, e.g. "ממתין למענה". */
      state: string
      /** How long it has been waiting, e.g. "47 דקות". */
      waiting: string
    }
  | {
      kind: 'summary'
      id: string
      /** One-line headline, e.g. "2 שיחות ממתינות למענה". */
      title: string
      detail?: string
    }

export type AgentTurn = {
  id: string
  role: 'user' | 'agent'
  text: string
  cards?: AgentCard[]
}

/** The four openers offered on the empty state. */
export const AGENT_SUGGESTIONS = [
  'מה דורש ממני טיפול היום?',
  'הצג לידים שלא קיבלו מענה',
  'סכם לי את השיחות האחרונות',
  'מה פספסתי היום?',
] as const

type MockAnswer = { text: string; cards?: AgentCard[] }

const ANSWERS: Record<string, MockAnswer> = {
  'מה דורש ממני טיפול היום?': {
    text: 'יש 3 דברים שכדאי לשים לב אליהם היום.',
    cards: [
      { kind: 'lead', id: 'a1', name: 'דוד כהן', status: 'ליד חדש', state: 'ממתין למענה', waiting: '47 דקות' },
      { kind: 'lead', id: 'a2', name: 'מיכל אברהם', status: 'בטיפול', state: 'ממתין למענה', waiting: '3 שעות' },
      { kind: 'summary', id: 'a3', title: '2 שיחות ממתינות למענה', detail: 'הגיעו מוואטסאפ אתמול בערב' },
    ],
  },
  'הצג לידים שלא קיבלו מענה': {
    text: '4 לידים עדיין לא קיבלו מענה. שניים מהם נכנסו היום.',
    cards: [
      { kind: 'lead', id: 'b1', name: 'דוד כהן', status: 'ליד חדש', state: 'ממתין למענה', waiting: '47 דקות' },
      { kind: 'lead', id: 'b2', name: 'רונית לוי', status: 'ליד חדש', state: 'ממתין למענה', waiting: '5 שעות' },
      { kind: 'lead', id: 'b3', name: 'עמית שרון', status: 'ליד חדש', state: 'ממתין למענה', waiting: 'יומיים' },
    ],
  },
  'סכם לי את השיחות האחרונות': {
    text: 'בשלוש השיחות האחרונות שאלו על זמינות ומחיר. באחת מהן ביקשו לחזור אליהם מחר בבוקר.',
    cards: [
      { kind: 'summary', id: 'c1', title: '3 שיחות מאתמול', detail: 'שתיים נענו, אחת ממתינה' },
      { kind: 'lead', id: 'c2', name: 'מיכל אברהם', status: 'בטיפול', state: 'ביקשה חזרה מחר', waiting: '9:00' },
    ],
  },
  'מה פספסתי היום?': {
    text: 'לא פספסת הרבה. נכנסו 5 לידים חדשים, ואחד מהם ממתין למענה יותר משעה.',
    cards: [
      { kind: 'summary', id: 'd1', title: '5 לידים חדשים היום', detail: '4 מהם כבר קיבלו מענה' },
      { kind: 'lead', id: 'd2', name: 'דוד כהן', status: 'ליד חדש', state: 'ממתין למענה', waiting: '47 דקות' },
    ],
  },
}

/**
 * The sample answer for a prompt.
 *
 * Anything the sample set does not cover gets an honest "not yet" rather than an
 * invented answer — a prototype that makes something up for every input teaches
 * exactly the wrong thing about how the real agent behaves (care-charter Law 2).
 */
export function mockAnswerFor(prompt: string): MockAnswer {
  const known = ANSWERS[prompt.trim()]
  if (known) return known
  return {
    text: 'זו תצוגה מקדימה של הסוכן, ועדיין אין לי חיבור לנתונים של העסק. אפשר לנסות אחת מההצעות המוכנות כדי לראות איך תיראה תשובה.',
  }
}
