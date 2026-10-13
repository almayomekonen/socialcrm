import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'

/**
 * A questionnaire shaped like agency 103's (docs/superpowers/specs/2026-10-13-
 * questionnaire-natural-answers-design.md §8). Synthetic: no customer data.
 */
export const NATURAL_DEFINITION_RAW = {
  schemaVersion: 1,
  revision: 1,
  language: 'he',
  welcome: 'שלום וברוכים הבאים.',
  closing: 'תודה, קיבלנו את הפרטים.',
  handoff: 'נציג יחזור אליך כאן.',
  summaryTitle: 'שאלון וואטסאפ',
  maxInvalidAttempts: 3,
  expireAfterHours: 24,
  steps: [
    {
      id: 'needs',
      type: 'choice',
      multi: true,
      label: 'צורך',
      prompt: 'איך נוכל לעזור?',
      options: [
        { id: 'leads', label: 'ניהול פניות ולידים', aliases: ['ניהול', 'לידים'] },
        { id: 'auto', label: 'מענה אוטומטי בוואטסאפ' },
        { id: 'follow', label: 'מעקב אחרי לקוחות' },
        { id: 'team', label: 'ניהול צוות ומשימות', aliases: ['ניהול צוות'] },
        { id: 'other', label: 'אחר' },
      ],
    },
    {
      id: 'industry',
      type: 'choice',
      multi: true,
      label: 'תחום',
      prompt: 'באיזה תחום העסק?',
      options: [
        { id: 'services', label: 'שירותים וייעוץ' },
        { id: 'beauty', label: 'יופי וטיפוח' },
        { id: 'realestate', label: 'נדלן' },
        { id: 'other', label: 'אחר' },
      ],
    },
    {
      id: 'industry_other',
      type: 'text',
      label: 'פירוט תחום',
      prompt: 'באיזה תחום בדיוק?',
      when: { step: 'industry', anyOf: ['other'] },
    },
    {
      id: 'team',
      type: 'choice',
      label: 'צוות',
      prompt: 'כמה אנשים מטפלים בפניות?',
      options: [
        { id: 'solo', label: 'רק אני', aliases: ['לבד', 'עצמאי', 'עצמאית', 'רק אני'] },
        { id: 'small', label: '2 עד 3 אנשים', aliases: ['שניים', 'שני עובדים', 'שלושה'] },
        { id: 'mid', label: '4 עד 10 אנשים' },
      ],
    },
    {
      id: 'process',
      type: 'choice',
      label: 'תהליך',
      prompt: 'איך אתם מנהלים היום את הפניות?',
      options: [
        { id: 'wa', label: 'ישירות בוואטסאפ', aliases: ['וואטסאפ'] },
        { id: 'excel', label: 'Excel', aliases: ['אקסל'] },
        { id: 'none', label: 'אין לנו תהליך מסודר' },
      ],
    },
    {
      id: 'challenge',
      type: 'choice',
      multi: true,
      label: 'אתגר',
      prompt: 'מה האתגר העיקרי?',
      options: [
        { id: 'lost', label: 'פניות הולכות לאיבוד' },
        { id: 'slow', label: 'לוקח לנו זמן לענות', aliases: ['לא מספיק לענות'] },
        { id: 'blind', label: 'אין לנו תמונה ברורה' },
      ],
    },
    {
      id: 'source',
      type: 'choice',
      multi: true,
      label: 'מקור',
      prompt: 'מאיפה מגיעות הפניות?',
      options: [
        { id: 'whatsapp', label: 'WhatsApp', aliases: ['וואטסאפ'] },
        { id: 'instagram', label: 'Instagram', aliases: ['אינסטגרם'] },
        { id: 'facebook', label: 'Facebook', aliases: ['פייסבוק'] },
        { id: 'others', label: 'מקורות אחרים' },
      ],
    },
    {
      id: 'timing',
      type: 'choice',
      label: 'זמן',
      prompt: 'מתי נוח לדבר?',
      options: [
        { id: 'morning', label: 'בוקר', aliases: ['בבוקר'] },
        { id: 'noon', label: 'צהריים' },
        { id: 'evening', label: 'ערב', aliases: ['בערב'] },
      ],
    },
    { id: 'contact', type: 'text', label: 'חזרה', prompt: 'איך נחזור אליכם?' },
  ],
}

type Raw = typeof NATURAL_DEFINITION_RAW

export function naturalDefinition(over: (raw: Raw) => unknown = (r) => r): QuestionnaireDefinition {
  const parsed = parseQuestionnaireDefinition(over(structuredClone(NATURAL_DEFINITION_RAW)))
  if (parsed.ok === false) throw new Error(parsed.errors.join(', '))
  return parsed.definition
}

export const LONG_15 = 'אני עושה צילום אירועים בעיקר חתונות ובר מצוות באזור המרכז ולפעמים גם צילומי משפחה'
/** 1,200 characters, no trailing space (so a stored row can be found by exact text). */
export const LONG_1200 = 'צילום אירועים בכל הארץ עם צוות קטן '.repeat(40).slice(0, 1199).trimEnd().padEnd(1200, 'ם')

/** Every input the spec's tables name, by the step it is sent at. */
export const PARITY_INPUTS: Array<{ step: string; texts: string[] }> = [
  { step: 'needs', texts: ['הכל'] },
  { step: 'needs', texts: ['הכול'] },
  { step: 'needs', texts: ['כולם'] },
  { step: 'needs', texts: ['את הכל'] },
  { step: 'needs', texts: ['הכל תודה'] },
  { step: 'needs', texts: ['1', '2', '3'] },
  { step: 'needs', texts: ['1\n2\n3'] },
  { step: 'needs', texts: ['לא הכל'] },
  { step: 'needs', texts: ['כמעט הכל'] },
  { step: 'needs', texts: ['הכל בסדר'] },
  { step: 'needs', texts: ['הכל?'] },
  { step: 'needs', texts: ['ניהול צוות'] },
  { step: 'needs', texts: ['ניהול צוות ולידים'] },
  { step: 'needs', texts: ['אני נציג מכירות'] },
  { step: 'needs', texts: ['נציג'] },
  { step: 'needs', texts: ['אפשר לדבר עם מישהו?'] },
  { step: 'needs', texts: ['כמה זה עולה?'] },
  { step: 'industry', texts: ['צילום אירועים'] },
  { step: 'industry', texts: ['אני צלם אירועים'] },
  { step: 'industry', texts: ['שירותי צילום'] },
  { step: 'industry', texts: ['הכל'] },
  { step: 'industry', texts: [LONG_15] },
  { step: 'industry', texts: [LONG_1200] },
  { step: 'industry', texts: ['שלום'] },
  { step: 'industry', texts: ['?'] },
  { step: 'industry', texts: ['מה המחיר?'] },
  { step: 'team', texts: ['עצמאי'] },
  { step: 'team', texts: ['לבד'] },
  { step: 'team', texts: ['אני עובד עם עסקים בכל הארץ'] },
  { step: 'team', texts: ['הכל'] },
  { step: 'team', texts: ['אני לא עובד לבד, יש לי חמישה עובדים'] },
  { step: 'team', texts: ['עובדים איתי שלושה אבל בפניות מטפל רק אני'] },
  { step: 'team', texts: ['רוב הזמן אני לבד, לפעמים בעונה אחת עוזרת לי'] },
  { step: 'team', texts: ['וואטסאפ'] },
  { step: 'team', texts: ['אני נציג מכירות'] },
  { step: 'process', texts: ['הכל'] },
  { step: 'challenge', texts: ['אני לא מספיק לענות לכולם'] },
  { step: 'source', texts: ['בעיקר אינסטגרם וקצת פייסבוק'] },
  { step: 'source', texts: ['1', '3'] },
  { step: 'source', texts: ['1\n3'] },
  { step: 'source', texts: ['הכל'] },
  { step: 'source', texts: ['אולי בעתיד אינסטגרם, כרגע רק וואטסאפ'] },
  { step: 'source', texts: ['הכל חוץ מפייסבוק'] },
  {
    step: 'source',
    texts: ['הלקוחות כותבים לי בעיקר בוואטסאפ אבל גם הרבה מגיעים דרך פייסבוק ומדי פעם מישהו מאינסטגרם שראה פרסום'],
  },
  { step: 'timing', texts: ['בבוקר או בערב'] },
  { step: 'contact', texts: ['טלפונית ב14'] },
  { step: 'contact', texts: ['תתקשרו אליי ב14'] },
  { step: 'contact', texts: ['תחזרו אלי מחר בבוקר'] },
  { step: 'contact', texts: ['תחזרו אליי'] },
  { step: 'contact', texts: [LONG_1200] },
]
