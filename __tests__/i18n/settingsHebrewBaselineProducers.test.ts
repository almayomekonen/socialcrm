import { describe, expect, test } from 'vitest'
import { FACEBOOK_NOTICES, SHARED, WHATSAPP_NOTICES, facebookNotice, whatsappHealthNotice, whatsappNotice } from '@/lib/connections/messages'
import { metaSignupErrorNextStep } from '@/lib/connections/metaSignupErrorSteps'
import { TEMPLATE_REJECTION_COPY, TEMPLATE_STATUS_LABELS, TEMPLATE_VALIDATION_COPY, TEMPLATE_VARIABLES } from '@/lib/whatsapp/templates/messages'
import { validateTemplateInput } from '@/lib/whatsapp/templates/validate'
import { daysUntil, formatRenewalDate, relativeDaysLabel } from '@/components/settings/payment/subscriptionDates'
import { ISSUER_FIELDS } from '@/lib/billing/issuer/fields'
import { SCOPE_LABELS_HE } from '@/lib/oauth/server/config'
import { packages, PRO_INCLUDED } from '@/lib/plans'
import { formatBillingDate } from '@/lib/payments/cardTrial/firstCharge'

/**
 * HEBREW BASELINE — the label producers behind the user settings screens
 * (Phase E4), as JSON: every connection notice by code (plus the Meta-error and
 * health resolutions), every documented Meta signup step, the ready-made
 * message copy and validation, the billing-centre date words, the issuer
 * registry, the AI scope labels, the plan inclusions. Recorded BEFORE Phase E4
 * on unmodified product code; Hebrew output must stay byte-identical.
 */

const META_MESSAGES = [
  'You guessed too many times',
  'Your account is too new to create a business account',
  'You have limits on how often you can post',
  'You reached the limit for the number of businesses',
  "The name you chose for your business isn't valid",
  'Name verification already in progress',
  'User does not have permission to create WhatsApp Business Accounts',
  'Only a limited number WhatsApp Business accounts',
  "The business that you selected can't be verified",
  'This phone number has been blocked',
  'Maximum number of phone numbers reached',
  'This number already exists in your list of phone numbers',
  'This number is registered to an existing WhatsApp account',
  "This number doesn't appear to be valid",
  'Something has gone wrong',
  'Completely unknown',
]

describe('Hebrew baseline — settings label producers', () => {
  test('connection notices', () => {
    const health = ['operational', 'registration_pending', 'inbound_only', 'restricted', 'token', 'webhook', 'throttled', 'unknown', 'disconnected'].map((s) => [s, whatsappHealthNotice(s as never)])
    expect({
      SHARED,
      FACEBOOK_NOTICES,
      WHATSAPP_NOTICES,
      facebookUnknown: facebookNotice('nope'),
      whatsappSilent: [whatsappNotice('cancelled'), whatsappNotice('denied')],
      whatsappUnknown: whatsappNotice('nope'),
      metaError: META_MESSAGES.map((m) => whatsappNotice('meta_error', m)),
      metaSteps: META_MESSAGES.map((m) => metaSignupErrorNextStep(m)),
      health,
    }).toMatchSnapshot()
  })

  test('ready-made messages, billing dates, issuer registry, AI scopes, plan', () => {
    const now = new Date('2026-10-28T09:00:00Z')
    const inputs = [
      { displayTitle: '', bodyText: '', purpose: '', variables: [] },
      { displayTitle: 'x'.repeat(130), bodyText: 'y'.repeat(1100), purpose: 'UTILITY', variables: [] },
      { displayTitle: 'א', bodyText: 'שלום {{1}}', purpose: 'UTILITY', variables: [] },
      { displayTitle: 'א', bodyText: 'שלום', purpose: 'UTILITY', variables: [{ token: 'לא קיים', sample: 'x' }] },
    ]
    expect({
      TEMPLATE_STATUS_LABELS,
      TEMPLATE_REJECTION_COPY,
      TEMPLATE_VALIDATION_COPY,
      TEMPLATE_VARIABLES,
      validation: inputs.map((i) => validateTemplateInput(i as never)),
      relative: [-9, -2, -1, 0, 1, 2, 27].map(relativeDaysLabel),
      renewal: [formatRenewalDate(now), formatRenewalDate(now, { withYear: true })],
      daysUntil: daysUntil(new Date('2026-11-09T21:30:00Z'), now),
      billingDate: formatBillingDate(now),
      issuer: ISSUER_FIELDS.map(({ key, label, helpText, placeholder, options }) => ({ key, label, helpText, placeholder, options })),
      issuerValidation: ISSUER_FIELDS.map((f) => [f.key, f.validate('', { businessType: 'company' }), f.validate('12', { businessType: 'company' })]),
      SCOPE_LABELS_HE,
      packages,
      PRO_INCLUDED,
    }).toMatchSnapshot()
  })
})
