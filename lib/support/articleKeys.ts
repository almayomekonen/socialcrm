import type { MessageKey } from '@/lib/i18n/translate'

/**
 * Where each guide's words live in the catalog (`support.kb.*`, i18n Phase F5),
 * by slug, in the registry's own section / paragraph order. Literal keys so the
 * catalog checker sees every one used; supportCopyPin.test.ts asserts this map
 * has exactly the shape of GUIDE_ARTICLES and that the Hebrew catalog holds each
 * article's words verbatim.
 */
export type ArticleKeys = { title: MessageKey; summary: MessageKey; sections: { heading: MessageKey; body: MessageKey[] }[] }

export const ARTICLE_KEYS: Record<string, ArticleKeys> = {
  'connect-whatsapp': {
    title: 'support.kb.connectWhatsapp.title',
    summary: 'support.kb.connectWhatsapp.summary',
    sections: [
      { heading: 'support.kb.connectWhatsapp.s1.heading', body: ['support.kb.connectWhatsapp.s1.p1', 'support.kb.connectWhatsapp.s1.p2'] },
      { heading: 'support.kb.connectWhatsapp.s2.heading', body: ['support.kb.connectWhatsapp.s2.p1', 'support.kb.connectWhatsapp.s2.p2', 'support.kb.connectWhatsapp.s2.p3'] },
    ],
  },
  'whatsapp-not-receiving': {
    title: 'support.kb.whatsappNotReceiving.title',
    summary: 'support.kb.whatsappNotReceiving.summary',
    sections: [
      { heading: 'support.kb.whatsappNotReceiving.s1.heading', body: ['support.kb.whatsappNotReceiving.s1.p1', 'support.kb.whatsappNotReceiving.s1.p2'] },
      { heading: 'support.kb.whatsappNotReceiving.s2.heading', body: ['support.kb.whatsappNotReceiving.s2.p1'] },
    ],
  },
  'connect-facebook-instagram': {
    title: 'support.kb.connectFacebookInstagram.title',
    summary: 'support.kb.connectFacebookInstagram.summary',
    sections: [
      { heading: 'support.kb.connectFacebookInstagram.s1.heading', body: ['support.kb.connectFacebookInstagram.s1.p1'] },
      { heading: 'support.kb.connectFacebookInstagram.s2.heading', body: ['support.kb.connectFacebookInstagram.s2.p1', 'support.kb.connectFacebookInstagram.s2.p2'] },
    ],
  },
  'import-leads-excel': {
    title: 'support.kb.importLeadsExcel.title',
    summary: 'support.kb.importLeadsExcel.summary',
    sections: [
      { heading: 'support.kb.importLeadsExcel.s1.heading', body: ['support.kb.importLeadsExcel.s1.p1', 'support.kb.importLeadsExcel.s1.p2'] },
      { heading: 'support.kb.importLeadsExcel.s2.heading', body: ['support.kb.importLeadsExcel.s2.p1'] },
    ],
  },
  'lead-statuses': {
    title: 'support.kb.leadStatuses.title',
    summary: 'support.kb.leadStatuses.summary',
    sections: [
      { heading: 'support.kb.leadStatuses.s1.heading', body: ['support.kb.leadStatuses.s1.p1'] },
      { heading: 'support.kb.leadStatuses.s2.heading', body: ['support.kb.leadStatuses.s2.p1'] },
    ],
  },
  'automations-overview': {
    title: 'support.kb.automationsOverview.title',
    summary: 'support.kb.automationsOverview.summary',
    sections: [
      { heading: 'support.kb.automationsOverview.s1.heading', body: ['support.kb.automationsOverview.s1.p1'] },
      { heading: 'support.kb.automationsOverview.s2.heading', body: ['support.kb.automationsOverview.s2.p1'] },
    ],
  },
  'ai-assistant': {
    title: 'support.kb.aiAssistant.title',
    summary: 'support.kb.aiAssistant.summary',
    sections: [
      { heading: 'support.kb.aiAssistant.s1.heading', body: ['support.kb.aiAssistant.s1.p1'] },
      { heading: 'support.kb.aiAssistant.s2.heading', body: ['support.kb.aiAssistant.s2.p1'] },
    ],
  },
  'subscription-and-billing': {
    title: 'support.kb.subscriptionAndBilling.title',
    summary: 'support.kb.subscriptionAndBilling.summary',
    sections: [
      { heading: 'support.kb.subscriptionAndBilling.s1.heading', body: ['support.kb.subscriptionAndBilling.s1.p1'] },
      { heading: 'support.kb.subscriptionAndBilling.s2.heading', body: ['support.kb.subscriptionAndBilling.s2.p1'] },
    ],
  },
  'invite-team-members': {
    title: 'support.kb.inviteTeamMembers.title',
    summary: 'support.kb.inviteTeamMembers.summary',
    sections: [
      { heading: 'support.kb.inviteTeamMembers.s1.heading', body: ['support.kb.inviteTeamMembers.s1.p1'] },
      { heading: 'support.kb.inviteTeamMembers.s2.heading', body: ['support.kb.inviteTeamMembers.s2.p1'] },
    ],
  },
  'website-form-connection': {
    title: 'support.kb.websiteFormConnection.title',
    summary: 'support.kb.websiteFormConnection.summary',
    sections: [
      { heading: 'support.kb.websiteFormConnection.s1.heading', body: ['support.kb.websiteFormConnection.s1.p1'] },
      { heading: 'support.kb.websiteFormConnection.s2.heading', body: ['support.kb.websiteFormConnection.s2.p1'] },
    ],
  },
}
