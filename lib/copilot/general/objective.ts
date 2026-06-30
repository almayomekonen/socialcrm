export type Objective = 'action' | 'understand' | 'summarize' | 'create' | 'discover' | 'gaps' | 'waiting'

export interface ObjectiveInput {
  text: string
}

export interface InferObjectiveResult {
  objective: Objective
  reasoning: string
  confidence?: number
}

export const DEFAULT_OBJECTIVE: Objective = 'action'

const SIGNALS: { objective: Objective; phrases: string[] }[] = [
  { objective: 'create', phrases: ['נסח', 'תנסח', 'כתוב', 'תכתוב', 'הכן הודעה', 'צור', 'write', 'draft', 'compose'] },
  { objective: 'understand', phrases: ['למה', 'מדוע', 'הסבר', 'תסביר', 'להבין', 'why', 'explain', 'understand'] },
  {
    objective: 'summarize',
    phrases: [
      'סיכום',
      'סכם',
      'תסכם',
      'תמונת מצב',
      'מה המצב',
      'מה חדש',
      'חדש במערכת',
      'מה התחדש',
      'איך הולך',
      'איך העסק',
      'overview',
      'summary',
      'summarize',
      'status',
      "what's new",
      'how are we',
      'how is the business',
    ],
  },
  {
    // WAITING — "who is waiting for me": ball is in the rep's court. Before DISCOVER so
    // "מי מחכה" routes to obligation, not opportunity.
    objective: 'waiting',
    phrases: ['מי מחכה', 'מי ממתין', 'למי לא חזרתי', 'למי לא עניתי', 'who is waiting', 'waiting for me'],
  },
  {
    // DISCOVER — "who should I work on": ranked people by opportunity.
    objective: 'discover',
    phrases: ['על מי', 'מי הכי', 'במי לטפל', 'מי דורש', 'את מי', 'who should i', 'who needs', 'who to work'],
  },
  {
    objective: 'gaps',
    phrases: [
      'מפספס',
      'מפסיד',
      'נופל בין',
      'מה לא עובד',
      'איפה אני טועה',
      'מה נשמט',
      'missing',
      'slipping',
      'falling through',
      'gaps',
    ],
  },
  {
    objective: 'action',
    phrases: [
      'מה לעשות',
      'מה כדאי',
      'מה הכי חשוב',
      'במה לטפל',
      'מה דחוף',
      'דחוף',
      'על מה להתמקד',
      'מאיפה להתחיל',
      'מה עכשיו',
      'what should i do',
      'what to do',
      'priorit',
      'urgent',
      'next step',
      "what's next",
    ],
  },
]

const REASONS: Record<Objective, string> = {
  action: 'Detected a request to act or prioritize.',
  understand: 'Detected a request to understand or explain.',
  summarize: 'Detected a request to summarize the current state.',
  create: 'Detected a request to create or draft something.',
  discover: 'Detected a request to find which people to work on.',
  gaps: 'Detected a request to surface what is being missed.',
  waiting: 'Detected a request for who is awaiting a reply.',
}

const FALLBACK_REASON = 'No strong objective detected. Falling back to the default business objective.'

export function inferObjective(input: ObjectiveInput): InferObjectiveResult {
  const text = input.text.trim().toLowerCase()
  if (text) {
    for (const sig of SIGNALS) {
      if (sig.phrases.some((p) => text.includes(p))) {
        return { objective: sig.objective, reasoning: REASONS[sig.objective] }
      }
    }
  }
  return { objective: DEFAULT_OBJECTIVE, reasoning: FALLBACK_REASON }
}
