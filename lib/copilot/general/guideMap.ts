export type GuideEntry = { id: string; examples: string[]; answer: string; route?: string }

/**
 * Curated, hand-authored product guide. Answers are authored text + a deep-link
 * — never model-generated — so navigation help cannot hallucinate. Routes are
 * verified against the app's current top-level pages.
 */
export const GUIDE_ENTRIES: readonly GuideEntry[] = [
  {
    id: 'guide.importLeads',
    examples: ['איך מעלים לידים', 'ייבוא אקסל', 'להעלות קובץ לידים', 'איך מייבאים לידים'],
    answer: 'מסך לידים ← כפתור "העלה לידים" ← בחר קובץ אקסל.',
    route: '/leads',
  },
  {
    id: 'guide.connectWhatsapp',
    examples: ['איך מחברים וואטסאפ', 'חיבור whatsapp', 'להתחבר לוואטסאפ', 'איפה מחברים וואטסאפ'],
    answer: 'הגדרות ← אינטגרציות ← חיבור וואטסאפ. עקוב אחרי שלבי ההתחברות.',
    route: '/settings/integrations?section=whatsapp',
  },
  {
    id: 'guide.addLead',
    examples: ['איך מוסיפים ליד', 'הוספת ליד חדש', 'ליד חדש'],
    answer: 'מסך לידים ← "הוסף ליד".',
    route: '/leads',
  },
  {
    id: 'guide.calendar',
    examples: ['איפה היומן', 'קח אותי ליומן', 'יומן'],
    answer: 'מסך היומן מציג את הפגישות שלך.',
    route: '/calendar',
  },
  {
    id: 'guide.inbox',
    examples: ['איפה ההודעות', 'תיבת הודעות', 'inbox', 'איפה התיבה'],
    answer: 'מסך התיבה מרכז את שיחות הוואטסאפ הנכנסות.',
    route: '/inbox',
  },
] as const
