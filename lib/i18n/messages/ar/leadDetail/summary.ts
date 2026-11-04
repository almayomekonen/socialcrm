import type { Messages } from '../../../translate'

type L = Messages['leadDetail']

export const summary: L['summary'] = {
  nextFollowUp: 'المتابعة التالية: {date}',
  noFollowUp: 'لم يتم تحديد متابعة',
  lastInteraction: 'آخر تفاعل: {outcome}',
}

export const outcome: L['outcome'] = {
  call_no_answer: 'لم يُجب',
  call_reached: 'تحدّثنا',
  call_interested: 'مهتم',
  call_not_interested: 'غير مهتم',
  meeting_completed: 'اكتمل الاجتماع',
  meeting_no_show: 'لم يحضر الاجتماع',
}

export const followUp: L['followUp'] = {
  tomorrow: 'غدًا',
  in3Days: 'بعد 3 أيام',
  inWeek: 'بعد أسبوع',
  otherDate: 'تاريخ آخر…',
  remove: 'إزالة المتابعة',
  set: 'تحديد متابعة',
  current: 'المتابعة: {date}',
  toastSet: 'تم تحديد متابعة في {date}',
  toastCleared: 'تمت إزالة المتابعة',
  expired: 'تجديد الاشتراك يعيد إمكانية تحديد المتابعات',
}

export const firstLead: L['firstLead'] = {
  title: 'وصل أول عميل محتمل لديك',
  body: 'حدّد متى تعود إليه، وسيحرص SocialCRM على إعادته إليك في الوقت المناسب.',
  done: 'ممتاز. عميلك المحتمل قيد المتابعة.',
  backToLeads: 'العودة إلى العملاء المحتملين',
  dismiss: 'إغلاق',
}

export const tasks: L['tasks'] = {
  title: 'المهام',
  all: 'جميع المهام',
}

export const activity: L['activity'] = {
  title: 'الملاحظات والمكالمات',
  empty: 'لا توجد ملاحظات على هذا العميل المحتمل بعد. اكتب ما قيل في المكالمة لتتمكن من المتابعة من النقطة نفسها.',
  placeholder: 'ماذا قيل في المكالمة؟ وعلى ماذا اتفقتم؟',
  add: 'إضافة ملاحظة',
  saving: 'جارٍ الحفظ…',
  edit: 'تعديل الملاحظة',
  saveEdit: 'حفظ التغييرات',
  delete: 'حذف الملاحظة',
  confirmDelete: 'هل تريد حذف هذه الملاحظة؟ لا يمكن استعادتها.',
  errors: {
    empty: 'أدخل نص الملاحظة',
    tooLong: 'هذه الملاحظة طويلة جدًا. اختصرها وحاول مرة أخرى.',
    notFound: 'لم يتم العثور على العميل المحتمل أو الملاحظة. حدّث الصفحة وحاول مرة أخرى.',
  },
}

export const readyMessage: L['readyMessage'] = {
  open: 'إرسال رسالة جاهزة',
  title: 'إرسال رسالة جاهزة',
  intro: 'اختر رسالة معتمدة، وسيتم إرسالها إلى العميل المحتمل عبر WhatsApp.',
  legend: 'رسائل WhatsApp جاهزة للإرسال',
  preview: 'معاينة',
  previewEmpty: 'اختر رسالة لرؤية المعاينة',
  sending: 'جارٍ الإرسال…',
  send: 'إرسال الرسالة',
  sent: 'تم إرسال الرسالة',
  proTitle: 'إرسال الرسائل متاح مع Pro',
  proBody: 'تجديد الاشتراك يعيد إمكانية إرسال الرسائل إلى العملاء المحتملين.',
}
