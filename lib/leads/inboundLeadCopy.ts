/**
 * User-facing copy for the "this lead arrived automatically" surface.
 *
 * ONE source of wording: desktop `InboundLeadContextView` and the mobile
 * provenance card both read from here. Do not invent parallel marketing copy.
 */

export const INBOUND_LEAD_COPY = {
  facebookHeadline: 'הליד הזה הגיע אליך אוטומטית מ־Facebook',
  instagramHeadline: 'הליד הזה הגיע אליך אוטומטית מ־Instagram',
  facebookBody: 'הלקוח מילא את הטופס שלך, ו־SocialCRM קלט את הפרטים עבורך אוטומטית.',
  whatsappHeadline: 'הליד הזה הגיע אליך אוטומטית מ־WhatsApp',
  whatsappWithConversation: 'SocialCRM קלט את הליד והשיחה ברגע שהלקוח פנה אליך.',
  whatsappWithoutConversation: 'SocialCRM קלט את הליד ברגע שהלקוח פנה אליך.',
  capturedFieldsPrefix: 'נקלטו אוטומטית',
  capturedAtPrefix: 'נקלט אצלך ב־',
  openConversation: 'פתח את השיחה',
  formAnswersHeading: 'תשובות מהטופס',
  formAnswerEmpty: 'לא נענה',
} as const

export const CAPTURED_FIELD_LABELS = {
  name: 'שם',
  phone: 'טלפון',
  email: 'אימייל',
} as const
