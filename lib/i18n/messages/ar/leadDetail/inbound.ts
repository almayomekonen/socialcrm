import type { Messages } from '../../../translate'

type L = Messages['leadDetail']

export const inbound: L['inbound'] = {
  facebookHeadline: 'وصلك هذا العميل المحتمل تلقائيًا من Facebook',
  instagramHeadline: 'وصلك هذا العميل المحتمل تلقائيًا من Instagram',
  facebookBody: 'ملأ العميل النموذج الخاص بك، والتقط SocialCRM البيانات نيابةً عنك تلقائيًا.',
  whatsappHeadline: 'وصلك هذا العميل المحتمل تلقائيًا من WhatsApp',
  whatsappWithConversation: 'التقط SocialCRM العميل المحتمل والمحادثة لحظة تواصل العميل معك.',
  whatsappWithoutConversation: 'التقط SocialCRM العميل المحتمل لحظة تواصل العميل معك.',
  capturedFields: 'تم التقاطها تلقائيًا: {fields}',
  capturedAt: 'تم الالتقاط لديك في {date}',
  openConversation: 'فتح المحادثة',
  formAnswersHeading: 'إجابات النموذج',
  formAnswerEmpty: 'لم تتم الإجابة',
  field: { name: 'الاسم', phone: 'الهاتف', email: 'البريد الإلكتروني' },
}

export const formField: L['formField'] = {
  city: 'المدينة',
  state: 'الولاية',
  country: 'الدولة',
  province: 'المقاطعة',
  street_address: 'العنوان',
  post_code: 'الرمز البريدي',
  zip_code: 'الرمز البريدي (ZIP)',
  company_name: 'الشركة',
  job_title: 'المسمى الوظيفي',
  work_email: 'البريد الإلكتروني للعمل',
  work_phone_number: 'هاتف العمل',
  date_of_birth: 'تاريخ الميلاد',
  gender: 'الجنس',
  marital_status: 'الحالة الاجتماعية',
  relationship_status: 'حالة العلاقة',
}

export const ad: L['ad'] = {
  paid: 'وصل من إعلان على Meta',
  organic: 'وصل من نموذج عملاء محتملين عضوي (ليس من إعلان)',
  platform: { ig: 'إنستغرام', fb: 'فيسبوك' },
}
