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
 * Education-linked guides are English-only. Calendar/inbox stay the existing
 * Copilot copy (no tour). Hebrew examples remain so existing utterances still match.
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
    answer: 'On Leads, use Upload leads and choose an Excel file.\n\nI can walk you through it.',
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
    answer: 'Connect WhatsApp from Settings → Integrations → WhatsApp.\n\nI can walk you through it.',
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
    answer: 'On Leads, use Add lead.\n\nI can walk you through it.',
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
    answer: 'Your pipeline is on Leads. Status tabs show who needs a next step; Add lead is on the same screen.\n\nI can walk you through it.',
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
    answer: 'Open a lead to update Status after a call and set Follow up so you get a reminder.\n\nI can walk you through it.',
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
    answer: 'Ask Copilot what to do next. Shortcut: ⌘J / Ctrl+J. It never sends messages without your approval.\n\nI can walk you through it.',
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
    answer: 'Connect Facebook from Settings → Integrations → Facebook.\n\nI can walk you through it.',
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
