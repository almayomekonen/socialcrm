import type { Messages } from '../../../translate'

type I = Messages['inbox']

export const page: I['page'] = {
  title: 'المحادثات',
  conversation: 'المحادثة',
  unsupportedChannel: 'محادثات {channel} غير مدعومة هنا بعد.',
  loading: 'جارٍ التحميل…',
}

export const toolbar: I['toolbar'] = {
  status: {
    label: 'الحالة',
    all: 'الكل',
    open: 'مفتوحة',
    closed: 'مغلقة',
    archived: 'في الأرشيف',
  },
  sort: {
    label: 'الترتيب',
    latest: 'أحدث نشاط',
    oldest: 'أقدم نشاط',
    unread: 'غير المقروءة أولًا',
    temperature: 'العملاء المحتملون المهتمون أولًا',
    intent: 'حسب نية العميل المحتمل',
    action: 'حسب الخطوة المقترحة',
  },
  intel: {
    label: 'تصفية ذكية',
    all: 'كل المحادثات',
    hot: 'عملاء محتملون مهتمون جدًا',
    attention: 'تتطلب معالجة فورية',
    pricing: 'طلبات أسعار',
    demo: 'طلبات عرض توضيحي',
    support: 'طلبات خدمة',
    escalation: 'تصعيدات الخدمة',
    followup: 'تتطلب متابعة',
  },
  smart: {
    hot: 'محادثات ساخنة',
    attention: 'تتطلب معالجة فورية',
    demo: 'فرص عرض توضيحي',
    escalation: 'تصعيدات الخدمة',
  },
  searchPlaceholder: 'ابحث بالاسم أو الهاتف أو الرسالة',
  searchLabel: 'البحث في المحادثات',
  unread: 'غير مقروءة',
  needsReply: 'بانتظار الرد',
}

export const channels: I['channels'] = {
  label: 'القناة',
  whatsapp: 'المحادثات',
  facebook: 'التعليقات',
  messengerUnread: {
    zero: 'لا توجد محادثات غير مقروءة',
    one: 'محادثة واحدة غير مقروءة',
    two: 'محادثتان غير مقروءتين',
    few: '{count} محادثات غير مقروءة',
    many: '{count} محادثة غير مقروءة',
    other: '{count} محادثة غير مقروءة',
  },
}

export const list: I['list'] = {
  empty: 'لم يتم العثور على محادثات',
  loadMore: 'تحميل المزيد',
  loadingMore: 'جارٍ التحميل...',
}

export const row: I['row'] = {
  fallbackName: 'محادثة',
  avatarFallback: 'ع',
  sentPrefix: 'أُرسلت:',
  nextStep: 'الخطوة التالية: {action}',
  unread: 'غير مقروءة',
}

export const empty: I['empty'] = {
  pickTitle: 'اختر محادثة من القائمة للبدء',
  pickBody: 'ستظهر هنا الرسائل والتحليل والخطوة التالية المقترحة.',
  noneTitle: 'لا توجد محادثات واتساب بعد',
  noneBody: 'عندما يكتب عميل محتمل على واتساب، ستظهر المحادثة هنا تلقائيًا.',
}

export const intel: I['intel'] = {
  intent: {
    pricing: 'مهتم بالسعر',
    demo: 'يطلب عرضًا توضيحيًا',
    signup: 'يرغب في الانضمام',
    support: 'طلب خدمة',
    followup: 'متابعة',
    information: 'يطلب معلومات',
  },
  temperature: {
    hot: 'عميل محتمل مهتم جدًا',
    warm: 'عميل محتمل متوسط الاهتمام',
    cold: 'عميل محتمل ضعيف الاهتمام',
  },
  action: {
    send_quote: 'أرسل عرض سعر',
    schedule_demo: 'حدّد موعدًا لعرض توضيحي',
    follow_up: 'أرسل رسالة متابعة',
    answer_question: 'أجب عن سؤال العميل المحتمل',
    close_lead: 'تقدّم نحو الإغلاق',
    escalate_support: 'حوّل إلى فريق الخدمة',
  },
  confidence: {
    high: 'ثقة عالية',
    medium: 'ثقة متوسطة',
    low: 'ثقة منخفضة',
  },
}
