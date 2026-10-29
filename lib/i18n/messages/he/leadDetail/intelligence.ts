/**
 * The lead intelligence card's own chrome (card, skeleton, Pro teaser, refresh).
 * AI-generated text is never here — it stays as generated (decision D3).
 * `source.*` labels the FIXED category values the model must pick from
 * (`SourceCategory` in lib/ai/prompts/leadIntelligence.ts), by value.
 */
export const intelligence = {
  title: 'תקציר חכם',
  unavailable: 'העוזר החכם לא זמין כרגע. נסו שוב בעוד דקה.',
  confidence: { high: 'ביטחון גבוה', medium: 'ביטחון בינוני', low: 'ביטחון נמוך' },
  nextAction: 'פעולה מומלצת',
  basedOn: 'מבוסס על: {sources}',
  source: {
    status: 'סטטוס הליד',
    activity: 'פעילות אחרונה',
    tasks: 'היסטוריית המשימות',
    details: 'פרטי הליד',
    origin: 'מקור הליד',
    handling: 'הטיפול בליד',
  },
  skeleton: {
    analyzing: 'מנתח…',
    loading: 'טוען תובנות חכמות עבור הליד',
    step1: 'מנתח את היסטוריית הליד…',
    step2: 'בודק פעילות ומשימות אחרונות…',
    step3: 'מזהה דפוסים והזדמנויות…',
    step4: 'בוחן רמת מעורבות וסיכון…',
    step5: 'מכין תובנות מותאמות…',
  },
  teaser: {
    label: 'תקציר חכם, זמין עם Pro',
    body: 'התקציר החכם מנתח את הליד ומציע את הצעד הבא.',
    cta: 'לצפייה בתקציר',
    proTitle: 'התקציר החכם זמין עם Pro',
    proBody: 'חידוש המנוי יחזיר את התקציר החכם.',
  },
  refresh: {
    action: 'רענן תובנות',
    pending: 'מרענן…',
    rateLimited: 'נסה שוב בעוד דקה',
    failed: 'לא ניתן לרענן כרגע',
  },
} as const
