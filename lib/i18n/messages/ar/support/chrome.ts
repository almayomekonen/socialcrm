import type { Messages } from '../../../translate'

type S = Messages['support']

export const shell: S['shell'] = { back: 'العودة إلى النظام', genericName: 'مستخدم' }

export const center: S['center'] = {
  title: 'مركز الدعم',
  intro: 'هل هناك شيء لا يعمل كما ينبغي؟ نحن هنا للمساعدة.',
  mine: 'طلباتي',
  all: 'جميع الطلبات',
  guides: 'الأدلة',
  guidesDescription: 'كيفية استخدام SocialCRM',
}

export const kind: S['kind'] = {
  problem: { tileTitle: 'لدي مشكلة', tileDescription: 'شيء ما في SocialCRM لا يعمل', formTitle: 'ماذا حدث؟' },
  question: { tileTitle: 'لدي سؤال', tileDescription: 'مساعدة في استخدام النظام', formTitle: 'ما سؤالك؟' },
}

export const requests: S['requests'] = {
  intro: 'محادثاتك مع فريق SocialCRM.',
  emptyTitle: 'لم تتواصل معنا بعد',
  emptyBody: 'إذا كان هناك شيء لا يعمل كما ينبغي، أخبرنا وسنعالجه.',
}

export const newRequest: S['newRequest'] = {
  title: 'طلب جديد',
  intro: 'سنرد عليك هنا في مركز الدعم وكذلك بالبريد الإلكتروني.',
}

export const form: S['form'] = {
  addMore: 'هل تريد إضافة شيء؟',
  addMorePlaceholder: 'هل تريد إضافة شيء؟ (اختياري)',
  placeholder: 'أخبرنا باختصار بما حدث...',
  sending: 'جارٍ الإرسال…',
  send: 'إرسال الطلب',
  sent: 'تم إرسال الطلب. سنرد عليك قريبًا.',
}

export const reply: S['reply'] = {
  label: 'رد',
  reopens: 'سيؤدي الرد إلى إعادة فتح الطلب.',
  placeholder: 'اكتب هنا…',
  send: 'إرسال الرد',
}

export const status: S['status'] = {
  open: 'مفتوح',
  in_progress: 'قيد المعالجة',
  waiting_for_customer: 'بانتظار ردك',
  resolved: 'مغلق',
}

export const category: S['category'] = {
  leads: 'العملاء المحتملون',
  whatsapp: 'WhatsApp',
  meta: 'Facebook وInstagram',
  automations: 'الأتمتة',
  ai: 'المساعد الذكي',
  billing: 'الاشتراك والدفع',
  account: 'الحساب والإعدادات',
  integrations: 'التكاملات',
  otherTopic: 'أخرى',
}

export const author: S['author'] = { self: 'أنت', support: 'فريق SocialCRM' }

export const error: S['error'] = {
  forbidden: 'ليست لديك صلاحية لهذا الإجراء',
  not_found: 'لم يتم العثور على الطلب',
  invalid_subject: 'يجب كتابة موضوع قصير للطلب',
  invalid_body: 'يجب كتابة ما حدث',
  invalid_category: 'يجب اختيار موضوع من القائمة',
  rate_limited: 'تم إرسال طلبات كثيرة في وقت قصير. يمكنك المحاولة مرة أخرى بعد ساعة.',
  fallback: 'فشل الإجراء. يرجى المحاولة مرة أخرى.',
}

export const search: S['search'] = {
  label: 'هل تبحث عن شرح؟',
  placeholder: 'البحث في الأدلة…',
  searching: 'جارٍ البحث…',
}

export const guides: S['guides'] = {
  intro: 'شروحات قصيرة حسب الموضوع.',
  emptyTitle: 'لم يتم العثور على أدلة',
  emptyBody: 'يمكنك إخبارنا بما حدث وسنساعدك.',
  notFound: 'لم تجد ما تبحث عنه؟',
  notSolved: 'ألم يحل هذا المشكلة؟',
  tellUs: 'أخبرنا بما حدث',
}
