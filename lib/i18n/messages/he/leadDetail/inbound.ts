/**
 * "This lead arrived automatically" context and Meta ad attribution. Hebrew is
 * the wording of `INBOUND_LEAD_COPY` (the mobile provenance card still reads
 * that constant). Meta form questions/answers and ad names are external data
 * and never appear here; `formField` labels only Meta's STANDARD question keys.
 */
export const inbound = {
  facebookHeadline: 'הליד הזה הגיע אליך אוטומטית מ־Facebook',
  instagramHeadline: 'הליד הזה הגיע אליך אוטומטית מ־Instagram',
  facebookBody: 'הלקוח מילא את הטופס שלך, ו־SocialCRM קלט את הפרטים עבורך אוטומטית.',
  whatsappHeadline: 'הליד הזה הגיע אליך אוטומטית מ־WhatsApp',
  whatsappWithConversation: 'SocialCRM קלט את הליד והשיחה ברגע שהלקוח פנה אליך.',
  whatsappWithoutConversation: 'SocialCRM קלט את הליד ברגע שהלקוח פנה אליך.',
  capturedFields: 'נקלטו אוטומטית: {fields}',
  capturedAt: 'נקלט אצלך ב־{date}',
  openConversation: 'פתח את השיחה',
  formAnswersHeading: 'תשובות מהטופס',
  formAnswerEmpty: 'לא נענה',
  field: { name: 'שם', phone: 'טלפון', email: 'אימייל' },
} as const

export const formField = {
  city: 'עיר',
  state: 'מחוז',
  country: 'מדינה',
  province: 'מחוז',
  street_address: 'כתובת',
  post_code: 'מיקוד',
  zip_code: 'מיקוד',
  company_name: 'חברה',
  job_title: 'תפקיד',
  work_email: 'אימייל בעבודה',
  work_phone_number: 'טלפון בעבודה',
  date_of_birth: 'תאריך לידה',
  gender: 'מגדר',
  marital_status: 'מצב משפחתי',
  relationship_status: 'מצב משפחתי',
} as const

export const ad = {
  paid: 'הגיע ממודעה ב-Meta',
  organic: 'הגיע מטופס לידים אורגני (לא ממודעה)',
  platform: { ig: 'אינסטגרם', fb: 'פייסבוק' },
} as const
