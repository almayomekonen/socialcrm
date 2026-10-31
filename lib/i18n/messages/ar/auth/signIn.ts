import type { Messages } from '../../../translate'

type A = Messages['auth']

export const signIn: A['signIn'] = {
  title: 'تسجيل الدخول | SocialCRM — نظام إدارة العملاء المحتملين',
  heading: 'مرحبًا بعودتك',
  subtitle: 'مرحبًا بعودتك، أدخل بياناتك للمتابعة',
  worksWith: 'يعمل مع واتساب وإنستغرام وفيسبوك',
  noAccount: 'ليس لديك حساب؟',
  join: 'انضم الآن',
  imageAlt: 'إدارة العملاء المحتملين للأعمال الصغيرة',
}

export const magic: A['magic'] = {
  email: 'البريد الإلكتروني',
  remember: 'تذكرني',
  resend: 'إعادة إرسال الرابط',
  submit: 'ابدأ مجانًا',
  submitting: 'جارٍ التحميل...',
  sent: 'تم إرسال رابط التحقق إلى بريدك الإلكتروني',
  linkInvalid: 'الرابط غير صالح أو انتهت صلاحيته',
  network: 'حدث خطأ في الشبكة، يرجى المحاولة مرة أخرى',
}

export const wait: A['wait'] = {
  slow: 'تستغرق العملية وقتًا أطول من المعتاد...',
  timeout: 'يستغرق الأمر وقتًا أطول بكثير من المعتاد، يرجى المحاولة مرة أخرى',
}

export const social: A['social'] = {
  signedInAs: 'تسجيل الدخول باسم {name}',
  google: 'تسجيل الدخول باستخدام Google',
  facebook: 'تسجيل الدخول باستخدام Facebook',
  failed: 'فشل تسجيل الدخول، يرجى المحاولة مرة أخرى',
}

export const register: A['register'] = {
  title: 'إنشاء حساب',
  heading: 'مرحبًا بك',
  subtitle: 'انضم الآن وابدأ في إدارة عملائك المحتملين بخطوات قليلة',
  businessName: 'اسم النشاط التجاري',
  firstName: 'الاسم الأول',
  lastName: 'اسم العائلة',
  terms: 'أوافق على شروط الاستخدام',
  termsLink: 'شروط الاستخدام',
  submit: 'إنشاء الحساب',
  haveAccount: 'لديك حساب بالفعل؟',
  signIn: 'تسجيل الدخول',
}

export const server: A['server'] = {
  suspended: 'هذا المستخدم موقوف',
  facebookNoEmail: 'لم يُرجع فيسبوك عنوان بريد إلكتروني. يمكنك تسجيل الدخول باستخدام Google أو البريد الإلكتروني.',
  facebookTaken: 'حساب فيسبوك هذا متصل بالنظام بالفعل. سجّل الدخول باستخدام Facebook.',
  facebookUnavailable: 'تسجيل الدخول باستخدام Facebook غير متاح لهذا الحساب',
  sendFailed: 'تعذّر إرسال رابط تسجيل الدخول. يرجى المحاولة مرة أخرى بعد لحظة.',
  emailInvalid: 'عنوان البريد الإلكتروني غير صالح. تحقّق من كتابته كاملًا، مثل name@gmail.com',
  emailTaken: 'عنوان البريد الإلكتروني هذا مسجّل بالفعل',
  generic: 'حدث خطأ، يرجى المحاولة مرة أخرى',
}
