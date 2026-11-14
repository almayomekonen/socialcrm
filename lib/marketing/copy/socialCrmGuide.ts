import { EN_LANGUAGE_NOTE, EN_TRIAL_OFFER_FAQ_ANSWER, EN } from '@/lib/marketing/copy/en'
import type { FaqSectionCopy } from '@/lib/marketing/copy/types'
import { PRICING } from '@/lib/pricing'

/**
 * `/en/social-crm` — an informational guide for "social CRM". It has no Hebrew
 * twin, so it declares no hreflang and canonicalises to itself.
 *
 * The general sections make no product claims. "How SocialCRM works" states
 * only what every account has (Meta Lead Ads, the official WhatsApp
 * connection, statuses, reps, the today list, Excel import/export) and says
 * plainly that the app is in Hebrew (EN_LANGUAGE_NOTE).
 */
export const SOCIAL_CRM_GUIDE_META = {
  path: '/en/social-crm',
  title: 'What Is Social CRM? A Practical Guide for Small Businesses',
  description:
    'Social CRM explained: how it differs from a traditional CRM, which channels matter, what social CRM software should do, and how to choose one.',
  ogTitle: 'What is social CRM? A practical guide',
  ogImage: '/media/og/en-social-crm.png',
}

export interface GuideSection {
  h2: string
  paragraphs: readonly string[]
  bullets?: readonly string[]
}

export const SOCIAL_CRM_GUIDE = {
  h1: 'What is social CRM?',
  intro: [
    'Social CRM is customer relationship management built around the channels where people actually reach small businesses today: WhatsApp, Instagram and Facebook. Instead of treating a message or a lead-form submission as a loose conversation in an app, a social CRM turns each one into a lead with an owner, a status and a date to follow up.',
    'This guide explains how social CRM differs from a traditional CRM, which channels matter, what social CRM software should do for you, and how to choose one without overbuying.',
  ],
  sections: [
    {
      h2: 'Social CRM vs. traditional CRM',
      paragraphs: [
        'A traditional CRM was designed around email, phone calls and a sales team that logs its own activity. Contacts arrive from a website form or a spreadsheet, a rep works them through a pipeline, and the system records what happened. It assumes that the conversation happens somewhere the CRM can see, or that someone will type it in.',
        'Social CRM starts from a different assumption: the conversation is already happening on a social channel, and the CRM has to meet it there. A prospect fills in a lead form inside a Facebook or Instagram ad. Another one sends a WhatsApp message after seeing a post. A third replies to a story. None of them visited your website, and none of them will fill in a contact form.',
        'So the job of a social CRM is less about logging activity and more about capture and follow-up. It pulls leads in from the social channels automatically where the platform allows it, keeps the conversation attached to the lead, and makes sure nobody waits too long for an answer.',
        'The term is sometimes used for social listening tools that track brand mentions across the internet. That is a different category. For a small business, social CRM usually means one practical thing: every person who reaches out on a social channel ends up in one list, and someone follows up.',
      ],
    },
    {
      h2: 'The channels that matter: WhatsApp, Instagram, Facebook',
      paragraphs: [
        'Which channels matter depends on where your customers are, but for many small businesses the answer is the three Meta platforms.',
      ],
      bullets: [
        'Facebook Lead Ads. People fill in a short form inside the ad without leaving Facebook. These leads are high intent but go cold fast, and by default they sit in Meta\'s tools until someone downloads them. A social CRM should connect to your Page and receive them automatically.',
        'Instagram. Lead ads on Instagram run through the same Meta connection as Facebook, so they can arrive automatically too. Direct messages are different: Instagram limits what outside tools can read, so many social CRMs, including ours, ask you to add those leads by hand.',
        'WhatsApp. In many countries it is where customers expect to talk to a business. A social CRM should connect through the official WhatsApp Business Platform rather than an unofficial browser extension, so that conversations arrive reliably and replies go out from your business number.',
      ],
    },
    {
      h2: 'What social CRM software should do',
      paragraphs: [
        'Feature lists for CRM software are long. For a small business working leads from social channels, a short list covers most of the value.',
      ],
      bullets: [
        'Bring leads in automatically wherever the platform allows it, with the source recorded, so you know which ad or channel each lead came from.',
        'Keep the conversation on the lead. When a different person picks up the lead, the history goes with it.',
        'Give every lead a status and an owner, and keep the statuses simple enough that people actually update them.',
        'Bring leads back when it is time to follow up, whether that is a date you set or a lead that has been waiting too long.',
        'Import what you already have from a spreadsheet, and let you export your data whenever you want.',
        'Price in a way that does not punish growth. Per-user pricing can make adding a second or third rep expensive.',
      ],
    },
    {
      h2: 'From DM to deal: a day in a social CRM',
      paragraphs: [
        'A typical day looks like this. Overnight, two people filled in a lead form on an Instagram ad and one person sent a WhatsApp message asking about prices. In the morning, all three are already in the list, each marked with where it came from. The WhatsApp lead has the message attached.',
        'You open the list of leads that need you today. It includes the three new ones, a lead you promised to call back this morning, and a lead marked as interested that nobody has touched in three days. You reply to the WhatsApp lead from inside the CRM and see when the message is delivered and read. You call the two form leads, update their status, and set a follow-up date for the one who asked you to call next week.',
        'At the end of the week you can see how many leads came from each channel and how many of them closed, because every lead kept its source from the moment it arrived.',
        'Nothing in that day required remembering anything. The leads came in on their own, the follow-ups came back on their own, and the history stayed with each lead.',
      ],
    },
    {
      h2: 'How to choose social CRM software',
      paragraphs: [
        'Before you commit, ask a few concrete questions. Vague answers to any of them are worth a second look.',
      ],
      bullets: [
        'Which of my channels connect automatically, and which require manual entry? Check this per channel, not in general.',
        'Is the WhatsApp connection official? Ask whether it uses the WhatsApp Business Platform.',
        'What will it cost for the team I expect to have in a year, not just for one user? Ask whether channel connections cost extra.',
        'How do I bring in my existing leads, and how do I get my data out?',
        'How long until I am working real leads? A tool that needs weeks of setup is built for a different kind of company.',
        'Can I cancel myself, and what happens to my data afterwards?',
        'Is the interface in my language? This matters more than it seems for the people who use it every day.',
      ],
    },
    {
      h2: 'How SocialCRM works',
      paragraphs: [
        'SocialCRM is a social CRM for small businesses that get their leads from Facebook, Instagram and WhatsApp. You connect your Facebook Page once, and anyone who fills in a lead form in your Facebook or Instagram ads is added to the list automatically, with their answers and the ad they came from. You connect your WhatsApp Business number through Meta\'s official signup, and each WhatsApp conversation is linked to a lead.',
        'Every lead has one of five statuses: new, contacted, interested, closed or lost. You assign it to a rep and set a date to follow up. When that date arrives, or when a lead has waited too long in its status, it comes back to the list of leads that need you today. You can import existing leads from an Excel or CSV file, and export to Excel or PDF at any time.',
        `Pricing is ${PRICING.currency}${PRICING.monthly} per month for the whole workspace, with no fee per rep. ${EN_LANGUAGE_NOTE}`,
      ],
    },
  ] as readonly GuideSection[],
}

export const SOCIAL_CRM_GUIDE_FAQ: FaqSectionCopy = {
  ...EN.faq,
  title: 'Social CRM FAQ',
  items: [
    {
      id: 'sc-1',
      question: 'What is the difference between social CRM and social media management tools?',
      answer:
        'Social media management tools schedule posts and report on reach. A social CRM manages the people who reach out to you: it captures them as leads, tracks their status and makes sure someone follows up.',
    },
    {
      id: 'sc-2',
      question: 'Do I need a social CRM if I only use WhatsApp?',
      answer:
        'If a handful of conversations a week is all you get, the WhatsApp Business app may be enough. Once several people handle leads, or leads start slipping through, a CRM that turns each conversation into a lead with an owner and a follow-up date starts paying for itself.',
    },
    {
      id: 'sc-3',
      question: 'Can a social CRM read Instagram direct messages?',
      answer:
        'It depends on the tool and on what Instagram allows. In SocialCRM, Instagram lead ads arrive automatically, and leads from direct messages are added by hand in a few seconds.',
    },
    {
      id: 'sc-4',
      question: 'Is SocialCRM available in English?',
      answer: EN_LANGUAGE_NOTE,
    },
    {
      id: 'sc-5',
      question: 'How much does SocialCRM cost?',
      answer: EN_TRIAL_OFFER_FAQ_ANSWER,
    },
  ],
}
