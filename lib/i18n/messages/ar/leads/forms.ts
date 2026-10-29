import type { Messages } from '../../../translate'

type L = Messages['leads']

/** Arabic count phrase for "N leads" (counted noun forms per CLDR category). */
const leadsN = (suffix: string) => ({
  zero: `{count} عميل محتمل${suffix}`,
  one: `عميل محتمل واحد${suffix}`,
  two: `عميلان محتملان${suffix}`,
  few: `{count} عملاء محتملين${suffix}`,
  many: `{count} عميلًا محتملًا${suffix}`,
  other: `{count} عميل محتمل${suffix}`,
})

export const form: L['form'] = {
  addTitle: 'إضافة عميل محتمل',
  editTitle: 'تعديل العميل المحتمل',
  owner: 'مالك العميل المحتمل',
  firstName: 'الاسم الأول',
  lastName: 'اسم العائلة',
  gender: 'الجنس',
  phone: 'الهاتف المحمول',
  email: 'البريد الإلكتروني',
  birthDate: 'تاريخ الميلاد',
  leadSource: 'مصدر العميل المحتمل',
  handler: 'مسؤول إضافي (اختياري)',
  status: 'الحالة',
  kindLead: 'عميل محتمل',
  moreInfo: 'معلومات إضافية',
  idNum: 'رقم الهوية',
  secPhone: 'هاتف إضافي',
  idNumTaken: 'رقم الهوية هذا مرتبط بالعميل المحتمل {name}',
  idNumInvalid: 'رقم الهوية غير صالح',
  genderOption: { male: 'ذكر', female: 'أنثى' },
  sourceOption: {
    manual: 'يدوي',
    website: 'الموقع',
    referral: 'توصية',
    import: 'استيراد',
    misc: 'أخرى',
  },
}

export const duplicate: L['duplicate'] = {
  strong: 'قد يكون هذا العميل المحتمل موجودًا بالفعل في النظام',
  soft: 'تم العثور على عميل محتمل مشابه في النظام',
  hide: 'إخفاء',
  unnamed: 'عميل محتمل بلا اسم',
  hint: 'إذا كان هو العميل المحتمل نفسه، يمكنك الإلغاء وتحديث الموجود. وإلا يمكنك المتابعة والحفظ.',
  signal: { idNum: 'رقم الهوية نفسه', phone: 'رقم الهاتف نفسه', email: 'البريد الإلكتروني نفسه' },
}

export const assign: L['assign'] = {
  titleMany: {
    zero: 'إسناد {count} عميل محتمل إلى مندوب',
    one: 'إسناد عميل محتمل واحد إلى مندوب',
    two: 'إسناد عميلين محتملين إلى مندوب',
    few: 'إسناد {count} عملاء محتملين إلى مندوب',
    many: 'إسناد {count} عميلًا محتملًا إلى مندوب',
    other: 'إسناد {count} عميل محتمل إلى مندوب',
  },
  pickRep: 'اختر مندوبًا',
  submit: 'إسناد إلى المندوب',
  cancel: 'إلغاء',
  confirmOne: 'هل تريد إسناد العميل المحتمل إلى {rep}؟',
  confirmMany: {
    zero: 'هل تريد إسناد {count} عميل محتمل إلى {rep}؟',
    one: 'هل تريد إسناد عميل محتمل واحد إلى {rep}؟',
    two: 'هل تريد إسناد عميلين محتملين إلى {rep}؟',
    few: 'هل تريد إسناد {count} عملاء محتملين إلى {rep}؟',
    many: 'هل تريد إسناد {count} عميلًا محتملًا إلى {rep}؟',
    other: 'هل تريد إسناد {count} عميل محتمل إلى {rep}؟',
  },
}

export const transfer: L['transfer'] = {
  title: 'نقل العميل المحتمل من المالك {owner}',
  pickOwner: 'اختر مالكًا جديدًا للعميل المحتمل',
  confirm: 'هل تريد نقل العميل المحتمل {name} إلى المالك {owner}؟',
}

export const list: L['list'] = {
  editTitle: 'تعديل القائمة',
  newTitle: 'إنشاء قائمة جديدة',
  delete: 'حذف القائمة',
  name: 'اسم القائمة',
  search: 'بحث',
  pickLeads: 'اختر العملاء المحتملين',
  pickRequired: 'يجب اختيار عملاء محتملين',
}

export const upload: L['upload'] = {
  proTitle: 'استيراد العملاء المحتملين متاح مع Pro',
  proBody: 'تجديد الاشتراك يعيد إمكانية استيراد العملاء المحتملين من ملف.',
  method: 'طريقة الاستيراد',
  fileTypes: 'ملف Excel أو CSV (xlsx, xls, csv)',
  fileHint: 'السطر الأول: الاسم الأول، الهاتف — ويمكن أيضًا اسم العائلة، البريد الإلكتروني، رقم الهوية.',
  excelButton: 'رفع ملف Excel',
  saved: 'العملاء المحتملون الذين تم حفظهم',
  imported: leadsN(' تم استيرادهم بنجاح'),
  viewYourLeads: 'عرض عملائك المحتملين',
  invalid: 'بيانات غير صالحة، لم تُحفظ',
  csvTitle: 'استيراد العملاء المحتملين من ملف CSV',
  csvHint: 'الأعمدة المطلوبة: الاسم، الهاتف، البريد الإلكتروني (هاتف أو بريد إلكتروني على الأقل)',
  processing: 'جارٍ المعالجة...',
  csvButton: 'رفع ملف CSV',
  allExist: 'جميع العملاء المحتملين موجودون بالفعل في النظام',
  alreadyUploaded: 'يبدو أن الملف رُفع من قبل',
  addedNew: leadsN(' جدد تمت إضافتهم'),
  unchanged: leadsN(' موجودون بالفعل ولم يتغيّروا'),
  allAdded: 'تمت إضافة جميع العملاء المحتملين بنجاح',
  noneAdded: 'لم تتم إضافة أي عميل محتمل',
  checkColumns: 'تحقق من أن الملف يتضمن عمود هاتف أو بريد إلكتروني',
  updated: {
    zero: 'لم يتم تحديث بيانات أي عميل محتمل',
    one: 'تم تحديث بيانات عميل محتمل واحد موجود',
    two: 'تم تحديث بيانات عميلين محتملين موجودين',
    few: 'تم تحديث بيانات {count} عملاء محتملين موجودين',
    many: 'تم تحديث بيانات {count} عميلًا محتملًا موجودًا',
    other: 'تم تحديث بيانات {count} عميل محتمل موجود',
  },
  invalidRows: 'أسطر غير صالحة: {n}',
  viewLeads: 'عرض العملاء المحتملين',
}
