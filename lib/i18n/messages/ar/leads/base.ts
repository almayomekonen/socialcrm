import type { Messages } from '../../../translate'

export const base: Pick<Messages['leads'], 'add' | 'outcome' | 'contact'> = {
  add: 'إضافة عميل محتمل',
  outcome: {
    noAnswer: 'لم يُجب',
    reached: 'تحدّثنا',
    interested: 'مهتم',
    notInterested: 'غير مهتم',
    title: 'نتيجة المكالمة',
    titleLabel: 'نتيجة المكالمة:',
    logAria: 'تسجيل نتيجة المكالمة',
    toast: {
      noAnswerOn: 'لم تتمكّن من الوصول إلى العميل المحتمل. سنذكّرك بالمحاولة مرة أخرى في {date}.',
      noAnswer: 'لم تتمكّن من الوصول إلى العميل المحتمل. أنشأنا تذكيرًا بالمحاولة مرة أخرى.',
      reachedOn: 'تم حفظ المكالمة. سيعود العميل المحتمل إلى قائمة المتابعة في {date}.',
      reached: 'تم حفظ المكالمة.',
      interestedOn: 'تم وسم العميل المحتمل كمهتم. سنعيده للمتابعة في {date} للتقدّم نحو الإغلاق.',
      interested: 'تم وسم العميل المحتمل كمهتم.',
      notInterested: 'تم وسم العميل المحتمل كغير ذي صلة وأُزيل من قائمة المتابعة.',
    },
  },
  contact: {
    call: 'اتصال',
    callName: 'الاتصال بـ{name}',
    whatsapp: 'واتساب',
    whatsappName: 'واتساب إلى {name}',
    opening: 'جارٍ الفتح…',
    noValidPhone: 'لا يوجد لدى العميل المحتمل رقم هاتف صالح لواتساب',
  },
}
