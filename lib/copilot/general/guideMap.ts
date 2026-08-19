import type { EducationActionId } from '@/lib/education/actions'

export type GuideEntry = {
  id: string
  examples: string[]
  answer: string
  route?: string
  educationAction?: EducationActionId
}

/**
 * Curated, hand-authored product guide. Answers are authored text + a deep-link
 * — never model-generated — so navigation help cannot hallucinate. Routes are
 * verified against the app's current top-level pages.
 *
 * Product-education-linked guides are Hebrew (the product language).
 * Calendar/inbox stay the existing Copilot copy (no tour).
 * Hebrew and English examples remain so existing utterances still match.
 */
export const GUIDE_ENTRIES: readonly GuideEntry[] = [
  {
    id: 'guide.importLeads',
    examples: [
      'איך מעלים לידים',
      'ייבוא אקסל',
      'להעלות קובץ לידים',
      'איך מייבאים לידים',
      'how do i import leads',
      'import leads',
      'upload excel leads',
    ],
    answer: 'במסך לידים לוחצים על «העלה לידים» ובוחרים קובץ אקסל.\n\nאפשר להראות לך.',
    route: '/leads',
    educationAction: 'open_pipeline_tour',
  },
  {
    id: 'guide.connectWhatsapp',
    examples: [
      'איך מחברים וואטסאפ',
      'חיבור whatsapp',
      'להתחבר לוואטסאפ',
      'איפה מחברים וואטסאפ',
      'how do i connect whatsapp',
      'connect whatsapp',
      'whatsapp integration',
    ],
    answer: 'מחברים וואטסאפ בהגדרות ← אינטגרציות ← וואטסאפ.\n\nאפשר להראות לך.',
    route: '/settings/integrations?section=whatsapp',
    educationAction: 'open_whatsapp_tour',
  },
  {
    id: 'guide.addLead',
    examples: [
      'איך מוסיפים ליד',
      'הוספת ליד חדש',
      'ליד חדש',
      'how do i add a lead',
      'add a new lead',
      'create a lead',
    ],
    answer: 'במסך לידים לוחצים על «הוסף ליד».\n\nאפשר להראות לך.',
    route: '/leads',
    educationAction: 'open_pipeline_tour',
  },
  {
    id: 'guide.pipeline',
    examples: [
      'איך משתמשים בפייפליין',
      'how do i use the pipeline',
      'how does the pipeline work',
      'show me the pipeline',
      'leads pipeline',
    ],
    answer: 'הפייפליין נמצא במסך לידים. לשוניות הסטטוס מראות למי לחזור; «הוסף ליד» באותו מסך.\n\nאפשר להראות לך.',
    route: '/leads',
    educationAction: 'open_pipeline_tour',
  },
  {
    id: 'guide.lead',
    examples: [
      'איך מטפלים בליד',
      'how do i use a lead',
      'how do i follow up',
      'lead status',
      'set a follow up',
    ],
    answer: 'פותחים ליד, מעדכנים סטטוס אחרי שיחה, וקובעים מעקב כדי לקבל תזכורת.\n\nאפשר להראות לך.',
    route: '/leads',
    educationAction: 'open_lead_tour',
  },
  {
    id: 'guide.copilot',
    examples: [
      'איך משתמשים בעוזר החכם',
      'how do i use copilot',
      'how do i use the smart assistant',
      'what is copilot',
      'smart assistant',
    ],
    answer: 'שואלים את העוזר החכם מה לעשות עכשיו. קיצור: ⌘J / Ctrl+J. הוא לא שולח הודעות בלי אישור.\n\nאפשר להראות לך.',
    educationAction: 'open_copilot_tour',
  },
  {
    id: 'guide.connectFacebook',
    examples: [
      'איך מחברים פייסבוק',
      'חיבור פייסבוק',
      'how do i connect facebook',
      'connect facebook',
      'connect instagram',
      'facebook integration',
    ],
    answer: 'מחברים פייסבוק בהגדרות ← אינטגרציות ← פייסבוק.\n\nאפשר להראות לך.',
    route: '/settings/integrations?section=facebook',
    educationAction: 'open_facebook_tour',
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
