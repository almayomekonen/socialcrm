import { translatorFor } from '@/lib/i18n/translators'

/**
 * User-facing copy for the "this lead arrived automatically" surface, in
 * HEBREW, for the mobile provenance card (Phase F). The wording lives in the
 * catalog (`leadDetail.inbound.*`), which the translated desktop
 * `InboundLeadContextView` reads directly. Do not invent parallel copy.
 */
const he = translatorFor('he')

export const INBOUND_LEAD_COPY = {
  facebookHeadline: he('leadDetail.inbound.facebookHeadline'),
  instagramHeadline: he('leadDetail.inbound.instagramHeadline'),
  facebookBody: he('leadDetail.inbound.facebookBody'),
  whatsappHeadline: he('leadDetail.inbound.whatsappHeadline'),
  whatsappWithConversation: he('leadDetail.inbound.whatsappWithConversation'),
  whatsappWithoutConversation: he('leadDetail.inbound.whatsappWithoutConversation'),
  // Prefix fragments the mobile card glues to its values; the desktop view
  // uses the whole sentences `leadDetail.inbound.capturedFields` / `capturedAt`.
  capturedFieldsPrefix: 'נקלטו אוטומטית',
  capturedAtPrefix: 'נקלט אצלך ב־',
  openConversation: he('leadDetail.inbound.openConversation'),
  formAnswersHeading: he('leadDetail.inbound.formAnswersHeading'),
  formAnswerEmpty: he('leadDetail.inbound.formAnswerEmpty'),
} as const

export const CAPTURED_FIELD_LABELS = {
  name: he('leadDetail.inbound.field.name'),
  phone: he('leadDetail.inbound.field.phone'),
  email: he('leadDetail.inbound.field.email'),
} as const
