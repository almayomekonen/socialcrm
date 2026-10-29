import type { Messages } from '../../../translate'

type L = Messages['leads']

export const status: L['status'] = {
  new: 'جديد',
  contacted: 'قيد المتابعة',
  interested: 'مهتم',
  closed: 'مُغلق',
  lost: 'خاسر',
}

export const statusForm: L['statusForm'] = {
  new: 'جديد',
  contacted: 'قيد المتابعة',
  interested: 'مهتم',
  closed: 'مُغلق',
  lost: 'غير ذي صلة',
}

export const table: L['table'] = {
  header: {
    name: 'الاسم الكامل',
    phone: 'رقم الهاتف',
    status: 'الحالة',
    nextAction: 'الإجراء التالي',
    leadSource: 'المصدر',
    userName: 'مالك العميل المحتمل',
    handlerName: 'مسؤول إضافي (اختياري)',
    email: 'البريد الإلكتروني',
    idNum: 'رقم الهوية',
    secPhone: 'هاتف إضافي',
    birthDate: 'تاريخ الميلاد',
    gender: 'الجنس',
    leadStatus: 'حالة العميل المحتمل',
    lastContact: 'آخر تواصل',
  },
  actions: 'إجراءات',
  customer: 'عميل',
  nextAction: {
    new: 'اتصل الآن',
    contacted: 'تابِع',
    interested: 'أغلق الصفقة',
  },
  lastContact: {
    today: 'اليوم',
    yesterday: 'أمس',
    daysAgo: {
      zero: 'اليوم',
      one: 'قبل يوم واحد',
      two: 'قبل يومين',
      few: 'قبل {count} أيام',
      many: 'قبل {count} يومًا',
      other: 'قبل {count} يوم',
    },
  },
  statusUpdated: 'تم تحديث الحالة',
}

export const toolbar: L['toolbar'] = {
  clearSearch: 'مسح البحث',
  results: {
    zero: 'لا نتائج',
    one: 'نتيجة واحدة',
    two: 'نتيجتان',
    few: '{count} نتائج',
    many: '{count} نتيجةً',
    other: '{count} نتيجة',
  },
  assigning: 'جارٍ الإسناد... ({n})',
  assign: 'إسناد إلى مندوب ({n})',
  deleting: 'جارٍ الحذف... ({n})',
  deleteAll: 'حذف الكل ({n})',
  delete: 'حذف ({n})',
  deleteCustomers: 'حذف العملاء ({n})',
  sortPriority: 'الترتيب: الأكثر إلحاحًا',
  sortNewest: 'الترتيب: الأحدث',
  sortAria: 'ترتيب العملاء المحتملين',
  newLead: 'عميل محتمل جديد',
  newCustomer: 'عميل جديد',
  lists: 'القوائم',
  editList: 'تعديل القائمة',
  newList: 'قائمة جديدة',
  noRowsSelected: 'لم يتم تحديد أي صفوف في الجدول',
}

export const action: L['action'] = {
  open: 'فتح العميل المحتمل',
  edit: 'تعديل',
  deal: 'إغلاق صفقة',
  dealAnother: 'إضافة صفقة أخرى',
  dealLost: 'إضافة صفقة (عميل محتمل خاسر)',
  transfer: 'نقل إلى مالك آخر',
  delete: 'حذف',
}
