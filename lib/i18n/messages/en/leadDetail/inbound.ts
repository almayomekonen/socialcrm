import type { Messages } from '../../../translate'

type L = Messages['leadDetail']

export const inbound: L['inbound'] = {
  facebookHeadline: 'This lead reached you automatically from Facebook',
  instagramHeadline: 'This lead reached you automatically from Instagram',
  facebookBody: 'The customer filled in your form, and SocialCRM captured the details for you automatically.',
  whatsappHeadline: 'This lead reached you automatically from WhatsApp',
  whatsappWithConversation: 'SocialCRM captured the lead and the conversation the moment the customer contacted you.',
  whatsappWithoutConversation: 'SocialCRM captured the lead the moment the customer contacted you.',
  capturedFields: 'Captured automatically: {fields}',
  capturedAt: 'Captured on {date}',
  openConversation: 'Open the conversation',
  formAnswersHeading: 'Form answers',
  formAnswerEmpty: 'Not answered',
  field: { name: 'Name', phone: 'Phone', email: 'Email' },
}

export const formField: L['formField'] = {
  city: 'City',
  state: 'State',
  country: 'Country',
  province: 'Province',
  street_address: 'Address',
  post_code: 'Postal code',
  zip_code: 'ZIP code',
  company_name: 'Company',
  job_title: 'Job title',
  work_email: 'Work email',
  work_phone_number: 'Work phone',
  date_of_birth: 'Date of birth',
  gender: 'Gender',
  marital_status: 'Marital status',
  relationship_status: 'Relationship status',
}

export const ad: L['ad'] = {
  paid: 'Came from a Meta ad',
  organic: 'Came from an organic lead form (not an ad)',
  platform: { ig: 'Instagram', fb: 'Facebook' },
}
