import type { Automation } from './types'
import { IS_PROD, EMAIL_ENABLED } from '@/lib/email/config'
import { appUrl, unsubscribeUrlFor } from './config'
import {
  inactiveOwnerCandidates,
  ownersMissingFacebook,
  ownersMissingWhatsapp,
  ownersTrialEnding,
  ownersWithFirstLead,
} from './recipients'
import { isInactiveOwner } from './conditions'
import WelcomeEmail from '@/emails/templates/WelcomeEmail'
import FacebookNotConnectedEmail from '@/emails/templates/FacebookNotConnectedEmail'
import WhatsappNotConnectedEmail from '@/emails/templates/WhatsappNotConnectedEmail'
import FirstLeadEmail from '@/emails/templates/FirstLeadEmail'
import NoActivityEmail from '@/emails/templates/NoActivityEmail'
import TrialEndingEmail from '@/emails/templates/TrialEndingEmail'

export const AUTOMATIONS: Automation[] = [
  {
    key: 'welcome',
    description: 'Sent once on registration. Reuses the existing WelcomeEmail template.',
    enabled: true,
    priority: 'high',
    category: 'transactional',
    trigger: 'event',
    event: 'user.registered',
    // Backward compatibility: Welcome keeps its original operational gate
    // (WELCOME_EMAIL_ENABLED via EMAIL_ENABLED) — the automation system does not
    // change this existing production feature's behavior.
    gate: () => IS_PROD && EMAIL_ENABLED,
    subject: () => '🚀 ברוך הבא ל-SocialCRM',
    template: (r) => WelcomeEmail({ firstName: r.firstName ?? '', ctaUrl: appUrl('/dashboard') }),
  },
  {
    key: 'facebook_not_connected',
    description: '≥3 days after signup with no Facebook page connected — nudge to connect.',
    enabled: true,
    priority: 'highest',
    category: 'lifecycle',
    trigger: 'scheduled',
    subject: () => 'הגיע הזמן לחבר את פייסבוק ולקבל לידים אוטומטית',
    template: (r) =>
      FacebookNotConnectedEmail({
        firstName: r.firstName,
        ctaUrl: appUrl('/settings/facebook'),
        unsubscribeUrl: unsubscribeUrlFor(r.userId),
      }),
    audience: ownersMissingFacebook,
  },
  {
    key: 'whatsapp_not_connected',
    description: '≥3 days after signup with no WhatsApp connection — nudge to connect.',
    enabled: true,
    priority: 'high',
    category: 'lifecycle',
    trigger: 'scheduled',
    subject: () => 'הגיע הזמן לחבר את וואטסאפ ולרכז את כל השיחות',
    template: (r) =>
      WhatsappNotConnectedEmail({
        firstName: r.firstName,
        ctaUrl: appUrl('/settings/facebook'),
        unsubscribeUrl: unsubscribeUrlFor(r.userId),
      }),
    audience: ownersMissingWhatsapp,
  },
  {
    key: 'first_lead_received',
    description: 'Once the agency has its first lead — celebrate + drive to act on it.',
    enabled: true,
    priority: 'medium',
    category: 'lifecycle',
    trigger: 'scheduled',
    subject: () => 'הליד הראשון כבר במערכת',
    template: (r) =>
      FirstLeadEmail({ firstName: r.firstName, ctaUrl: appUrl('/leads'), unsubscribeUrl: unsubscribeUrlFor(r.userId) }),
    audience: ownersWithFirstLead,
  },
  {
    key: 'no_activity',
    description: 'Owner inactive ≥14d (temporary login-trail signal) — gentle re-engagement.',
    enabled: true,
    priority: 'low',
    category: 'lifecycle',
    trigger: 'scheduled',
    subject: () => 'הלידים שלך מחכים לך',
    template: (r) =>
      NoActivityEmail({ firstName: r.firstName, ctaUrl: appUrl('/dashboard'), unsubscribeUrl: unsubscribeUrlFor(r.userId) }),
    audience: inactiveOwnerCandidates,
    condition: isInactiveOwner,
  },
  {
    key: 'trial_ending',
    description: 'Trial active with ≤3 days remaining — service notice + upgrade path.',
    enabled: true,
    priority: 'high',
    category: 'transactional',
    trigger: 'scheduled',
    subject: () => 'תקופת הניסיון שלך מסתיימת בקרוב',
    template: (r) => TrialEndingEmail({ firstName: r.firstName, ctaUrl: appUrl('/settings/update_payment') }),
    audience: ownersTrialEnding,
  },
]
