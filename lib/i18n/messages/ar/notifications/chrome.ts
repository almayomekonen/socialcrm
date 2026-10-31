import type { Messages } from '../../../translate'

type M = Messages['notifications']

export const category: M['category'] = {
  leads: 'العملاء المحتملون',
  messages: 'المحادثات',
  followups: 'المتابعات',
  sla: 'أوقات الاستجابة',
  integrations: 'الاتصالات',
}

export const panel: M['panel'] = {
  markAll: 'تعليم الكل كمقروء',
  viewAll: 'كل الإشعارات',
  away: {
    title: 'أثناء غيابك',
    count: {
      zero: 'لا توجد إشعارات جديدة',
      one: 'إشعار جديد واحد',
      two: 'إشعاران جديدان',
      few: '{count} إشعارات جديدة',
      many: '{count} إشعارًا جديدًا',
      other: '{count} إشعار جديد',
    },
    category: '{label} {count}',
    separator: '، ',
  },
  empty: {
    title: 'لا توجد إشعارات جديدة',
    body: 'عندما يصل عميل محتمل جديد أو يحتاج أمر ما إلى معالجة، سيظهر هنا.',
  },
}

export const center: M['center'] = {
  empty: {
    title: 'لا توجد إشعارات',
    filteredTitle: 'لا توجد إشعارات تطابق التصفية',
    filteredBody: 'يمكنك إزالة التصفية لعرض كل الإشعارات.',
  },
  loadMore: 'عرض المزيد',
  loadFailed: 'تعذّر التحميل — حاول مرة أخرى',
}

export const filters: M['filters'] = {
  readState: 'حالة القراءة',
  category: 'الفئة',
  all: 'الكل',
  unread: 'غير مقروءة',
  allTypes: 'كل الأنواع',
  mobileLabel: 'تصفية الإشعارات',
}

export const toast: M['toast'] = {
  many: {
    zero: 'لا توجد إشعارات جديدة',
    one: 'إشعار جديد واحد',
    two: 'إشعاران جديدان',
    few: '{count} إشعارات جديدة',
    many: '{count} إشعارًا جديدًا',
    other: '{count} إشعار جديد',
  },
}
