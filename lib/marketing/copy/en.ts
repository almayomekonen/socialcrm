import { BUSINESS_EMAIL } from '@/lib/businessContact'
import { PRICING } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import type { HomeCopy } from './types'

/**
 * The English homepage copy, a faithful adaptation of `he.ts` for `/en`.
 *
 * DRAFT: not approved until the owner has reviewed it. Three rules bind every
 * edit: only claims the Hebrew already makes, no promise that a card from abroad
 * is accepted or that the product is available in any market, and every price
 * and trial length comes from lib/pricing and lib/trial.
 *
 * Terms follow claude/i18n-glossary.md: Lead, Rep, Follow-up, Auto-reply.
 * Over the soft file limit on purpose: one flat table of strings, no logic.
 */

const DAYS = TRIAL_LENGTH_DAYS
const MONTHLY = `${PRICING.currency}${PRICING.monthly}`

export const EN_TRIAL_CTA_LABEL = `Start your ${DAYS}-day trial`

/** The trial terms in one line, as the owner set them. "Free" appears only here and with the card requirement. */
export const EN_TRIAL_TERMS =
  `Card required. Your first ${DAYS} days are free. After that, your subscription renews automatically at ${MONTHLY}/month unless you cancel before the first charge.`

/** The English counterpart of TRIAL_OFFER_FAQ_ANSWER. */
export const EN_TRIAL_OFFER_FAQ_ANSWER =
  `${EN_TRIAL_TERMS} The subscription then continues monthly until cancelled, and all prices are in Israeli shekels (ILS). ` +
  `To verify the card, your card company may place a temporary hold of ${PRICING.currency}1. It isn't a charge, and the payment provider releases it within up to 10 days.`

export const EN_LANGUAGE_NOTE =
  'The SocialCRM app, including sign-up, is currently in Hebrew. Other interface languages are limited to our authorized multilingual pilot.'

export const EN_META = {
  title: 'Lead Management CRM for Small Businesses | SocialCRM',
  description:
    `A social CRM for small businesses: leads from WhatsApp, Facebook and Instagram in one list, with a status, a rep and follow-ups. ${DAYS}-day trial.`,
  ogDescription:
    'All your leads from Facebook, Instagram and WhatsApp in one place, with a conversation, a status and follow-up for every lead, so no inquiry slips through the cracks.',
  skipLink: 'Skip to content',
}

export const EN_SCHEMA = {
  organizationDescription: 'A lead and sales management system for small businesses in Israel',
  softwareDescription: 'A lead management system for small businesses: all your leads from Facebook, Instagram and WhatsApp in one place, without missing a lead.',
  websiteDescription: 'A lead management system for small businesses',
  featureList: [
    'Lead management from social media',
    'Automatic Facebook connection',
    'Lead import from Excel',
    'Sales tracking',
    'Rep and team management',
  ],
}

export const EN: HomeCopy = {
  nav: {
    dir: 'ltr',
    logoHref: '/en',
    product: {
      label: 'Product',
      subitems: [
        { label: 'All your leads in one place', href: '/en#features-carousel', description: 'Facebook, Instagram and WhatsApp flow into one list' },
        { label: 'Conversations connected to the lead', href: '/en#features-grid', description: 'Reply from the system and see when messages are delivered and read' },
        { label: 'AI that knows every lead', href: '/en#features-showcase', description: 'A summary, key points and the next step' },
      ],
    },
    // No Channels link: that page exists only in Hebrew, and everything here
    // stays on the English page.
    links: [
      { label: 'Pricing', href: '/en#pricing' },
      { label: 'FAQ', href: '/en#faq' },
    ],
    login: { label: 'Log in', href: '/auth' },
    trial: { label: EN_TRIAL_CTA_LABEL, href: '/auth' },
  },
  hero: {
    titleLine1: 'Keep every lead and inquiry',
    titleLine2: ' organized in one place.',
    subtitle: "You no longer have to remember who's waiting for an answer. Open it in the morning and see exactly who to get back to today.",
    cta: EN_TRIAL_CTA_LABEL,
    imageAlt: 'The SocialCRM interface, shown in Hebrew',
    languageNote: EN_LANGUAGE_NOTE,
  },
  logos: {
    lead: 'Your leads come from everywhere: WhatsApp, Facebook and Instagram. SocialCRM connects them all into one organized list.',
    websiteLabel: 'Website forms',
    websiteUrl: '/en',
    websiteDir: 'ltr',
  },
  featuresCarousel: {
    dir: 'ltr',
    titleLead: 'From the moment a lead comes in',
    titleTail: 'until it closes',
    subtitle: "Four things that happen automatically on every lead, so you don't have to remember them.",
    items: [
      { title: 'Every lead lands in one list', description: 'Leads from Facebook, Instagram and WhatsApp come in together, each with a source and a status.' },
      { title: 'The conversation and the lead are one', description: 'Reply from the system and see when each message was delivered and when it was read.' },
      { title: 'No follow-up slips through the cracks', description: "A lead waiting more than 24 hours comes back to today's list on its own." },
      { title: 'AI that knows the whole history', description: 'For every lead: a short summary, two key points and the recommended next step.' },
    ],
    mockupLang: 'he',
  },
  featuresGrid: {
    title: 'A lead management system that fits how you actually work',
    subtitle:
      'Assign a rep, update the status and follow up on every inquiry. SocialCRM brings order to your sales process and helps you respond faster, with no unnecessary forms, no complicated setup and nothing slowing you down.',
    items: [
      {
        imageAlt: 'WhatsApp auto-reply settings in SocialCRM, shown in Hebrew',
        title: 'WhatsApp auto-reply',
        description: "A lead who writes on WhatsApp gets a reply within seconds, even when you're away from the screen, and you continue the conversation from the system.",
      },
      {
        imageAlt: 'A list of ready-to-send WhatsApp messages in SocialCRM, shown in Hebrew',
        title: 'Ready-to-send WhatsApp messages',
        description: "Pre-approved message templates, ready to send. The lead's name and details fill in automatically, with no retyping.",
      },
      {
        imageAlt: 'The SocialCRM meeting calendar in week view, shown in Hebrew',
        title: 'Built-in meeting calendar',
        description: 'Every meeting you set with a lead appears in one calendar, in day, week or month view, and syncs automatically with your Google Calendar.',
      },
      {
        imageAlt: 'Deal comparison by category in SocialCRM, shown in Hebrew',
        title: 'Deal comparison',
        description: 'See how deals split across services, products, courses and subscriptions, and how much commission came in from each category.',
      },
      {
        imageAlt: 'SocialCRM business details across channels and documents, shown in Hebrew',
        title: 'All your business details in one place',
        description: 'Your business details are saved once and appear in WhatsApp, invoices, payments and customer emails, with no need to enter them again.',
      },
      {
        imageAlt: 'An automatic follow-up sequence for a lead in SocialCRM, shown in Hebrew',
        title: 'Follow-up automations',
        description: 'An automatic follow-up sequence for a lead: right away, after two days and after a week, until they get back to you.',
      },
    ],
  },
  featuresShowcase: {
    title: "Don't take our word for it. See how it works.",
    subtitle: 'This is what the list, the conversations, the statuses and the AI look like in daily work. The screens are shown in Hebrew, the language of the app today.',
    items: [
      {
        title: 'Leads from every channel land in one list',
        description:
          'Leads from Facebook and Instagram ads come in automatically, and WhatsApp conversations connect to the lead. Every inquiry has a source, a status, a rep and a date to get back to it, so no inquiry is left unanswered.',
      },
      {
        title: 'The conversation and the lead are one',
        description:
          'Reply directly from the system and see when each message was delivered and when it was read. Every message stays on the lead, even when the rep changes, and for a returning inquiry you send an approved template.',
      },
      {
        title: 'Every lead knows where it stands',
        description:
          "New, In progress, Interested, Closed, and Lost when it's over. These are the statuses the system actually works with, with no invented stages and no spreadsheet to maintain by hand.",
      },
      {
        title: 'Open a lead and know exactly what to do next',
        description:
          "The AI reads the lead's history, summarizes where it stands and suggests the next step, based on the information saved on the lead. A draft is sent only when you click send. Available on the Pro plan.",
      },
    ],
    mockupLang: 'he',
  },
  faq: {
    title: 'Frequently asked questions',
    items: [
      {
        id: 'faq-1',
        question: 'How do leads from Facebook and Instagram get into the system?',
        answer:
          'Connect your Facebook business page, and every lead who fills out a Lead Ad form enters the system automatically within seconds, with a source and a status. Leads from Instagram ads arrive the same way.',
      },
      {
        id: 'faq-2',
        question: 'Do Instagram direct messages come in automatically?',
        answer:
          "No. Instagram doesn't let outside systems read message content, so you add a direct-message inquiry by hand in about ten seconds: name, phone and Instagram as the source. Leads from Instagram ads, on the other hand, come in automatically.",
      },
      {
        id: 'faq-3',
        question: 'How does the WhatsApp connection work?',
        answer:
          'Connect your WhatsApp Business account, and conversations come into the system and connect to the lead with a source, a status and a rep. Reply directly from the system and see when each message was delivered and when it was read. For a returning inquiry, you can send an approved template.',
      },
      {
        id: 'faq-4',
        question: 'What does the AI actually do?',
        answer:
          'Every lead has a short summary, two key points and a recommended action with its reason, based on the history saved on the lead. You can ask for a draft follow-up message, ask what the next step is or ask anything about the lead. Drafts never send themselves: a message goes out only when you click send. The WhatsApp auto-reply is a separate feature. The AI layer is available on the Pro plan.',
      },
      {
        id: 'faq-5',
        question: 'How much does it cost?',
        answer: EN_TRIAL_OFFER_FAQ_ANSWER,
      },
      {
        id: 'faq-6',
        question: 'What language is SocialCRM in?',
        answer:
          'The signed-in app, including sign-up, is currently in Hebrew. Other interface languages are limited to our authorized multilingual pilot, so expect a Hebrew CRM when you sign up.',
      },
    ],
    cardTitle: 'Still have a question?',
    cardBodyBeforeDays: "Don't see your question here? Write to us and we'll get back to you. You can also start right away: a ",
    cardBodyAfterDays: '-day trial of the full system, with no charge during the trial.',
    cardCta: 'Talk to us',
    cardCtaHref: `mailto:${BUSINESS_EMAIL}`,
  },
  pricing: {
    titleLine1: 'Try the full system for a whole week, ',
    titleLine2: 'and decide before the first charge.',
    subtitleAfterDays: " days with everything in the system, including the full AI. To start, you save a credit card, and it isn't charged during the trial. All prices are in Israeli shekels (ILS).",
    recommended: 'Recommended plan',
    talkToUs: 'Talk to us',
    dir: 'ltr',
    logoHref: '/en',
    plans: {
      individual: {
        title: `${DAYS}-day trial`,
        subtitle: 'The full system',
        description: `Card required · First ${DAYS} days free`,
        priceSuffix: `for ${DAYS} days`,
        features: [
          `Everything in Pro, for ${DAYS} days`,
          'Unlimited leads',
          'Facebook, Instagram and WhatsApp connections',
          'Statuses, reps and follow-up dates',
          'Excel import, Excel and PDF export',
          'Smart summary and recommended action',
          'Drafts for follow-up messages',
          'Ask anything about the lead',
        ],
        ctaText: EN_TRIAL_TERMS,
        ctaButton: EN_TRIAL_CTA_LABEL,
      },
      team: {
        title: 'Pro',
        subtitle: 'When the leads start piling up',
        description: 'For a business or a sales team',
        priceSuffix: '/month',
        features: [
          'Unlimited leads',
          'Smart summary on every lead',
          'Recommended action with its reason',
          'Drafts for follow-up messages',
          'Ask anything about the lead',
          'Assign leads to reps',
          'Commission splits on shared deals',
          'One price for the workspace',
        ],
        ctaText: 'No extra cost per rep · Billed monthly until cancelled',
        ctaButton: 'Upgrade to Pro',
      },
    },
  },
  footer: {
    dir: 'ltr',
    logoHref: '/en',
    sections: [
      {
        title: 'Product',
        links: [
          { name: 'Lead management', href: '/en' },
          { name: 'Pricing', href: '/en#pricing' },
          { name: 'FAQ', href: '/en#faq' },
        ],
      },
      {
        title: 'Channels',
        links: [
          { name: 'Facebook', href: '/en#features-carousel' },
          { name: 'WhatsApp', href: '/en#features-carousel' },
          { name: 'Instagram', href: '/en#features-carousel' },
        ],
      },
      {
        title: 'Legal',
        links: [
          { name: 'Terms of use (Hebrew)', href: '/terms', hrefLang: 'he' },
          { name: 'Privacy policy (Hebrew)', href: '/privacy', hrefLang: 'he' },
          { name: 'Data deletion (Hebrew)', href: '/data-deletion', hrefLang: 'he' },
        ],
      },
    ],
    social: { facebook: 'Facebook', instagram: 'Instagram', email: 'Email' },
    phoneLabel: 'Phone:',
    addressLang: { lang: 'he', dir: 'rtl' },
    copyright: '© SocialCRM. All rights reserved.',
    copyrightHref: '/en',
    privacy: 'Privacy policy (Hebrew)',
    terms: 'Terms of use (Hebrew)',
    legalHrefLang: 'he',
  },
}
