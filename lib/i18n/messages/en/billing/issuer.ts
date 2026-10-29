import type { Messages } from '../../../translate'

type B = Messages['billing']

export const issuer: B['issuer'] = {
  dialogLabel: 'Business details',
  heading: 'Before you issue your first invoice',
  intro: 'A few one-time details about your business are needed. It only takes a few seconds, and they will appear on every invoice you issue.',
  submit: 'Save and continue',
  formHint: 'These details will appear on the documents you issue',
  saveFailed: "Couldn't save the business details",
  field: {
    name: { label: 'Business name', help: 'As it will appear on invoices', placeholder: 'For example: Rachel Cohen Consulting' },
    businessType: { label: 'Business type', help: 'Not sure? You can update it later in settings.' },
    taxId: { label: 'Business / Company ID', help: '8 digits for a self-employed business, 9 for a company. No dashes.' },
  },
  businessType: {
    exempt: { label: 'Exempt dealer (Osek Patur)', description: 'Annual income up to ₪120,000. Does not charge VAT.' },
    authorized: { label: 'Licensed dealer (Osek Murshe)', description: 'Most self-employed people in Israel. Charges VAT.' },
    company: { label: 'Limited company (Ltd.)', description: 'A company registered with the Registrar of Companies.' },
  },
  error: {
    nameRequired: 'Business name is required',
    businessTypeRequired: 'Choose a business type',
    taxIdRequired: 'Business / Company ID is required',
    taxIdInvalid: "The Business / Company ID doesn't look valid",
    emailInvalid: 'The email address is not valid',
  },
  setup: {
    label: 'Complete business details',
    heading: 'Business details are needed first',
    body: 'Before issuing the first invoice, the business details need to be added.',
    adminOnly: 'Only the account admin can do this — you can ask them to continue.',
    ok: 'Got it',
  },
}
