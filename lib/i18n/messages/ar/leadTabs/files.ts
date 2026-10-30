import type { Messages } from '../../../translate'

type L = Messages['leadTabs']

export const files: L['files'] = {
  title: 'ملفات العميل المحتمل',
  typeFilter: 'نوع الملف',
  sizeFilter: 'الحجم',
  sizeUpTo: 'حتى {size}',
  upload: 'رفع الملفات',
  deleteColumn: 'حذف',
  deleteButton: 'حذف المستند {name}',
  deleteConfirm: 'هل تريد حذف المستند {name}؟',
  header: {
    type: 'نوع الملف',
    name: 'اسم المستند',
    taskId: 'المهمة',
    createdAt: 'تاريخ الإنشاء',
    size: 'الحجم',
    createdByName: 'رفعه',
  },
  form: {
    title: 'إضافة ملفات جديدة',
    taskLink: 'ربط بمهمة (اختياري):',
    taskLabel: 'المهمة',
    submit: 'إضافة الملفات',
    noFiles: 'ارفع ملفًا واحدًا على الأقل',
  },
  uploader: {
    title: 'رفع الملفات',
    removeConfirm: 'هل تريد إزالة الملف؟',
    failed: 'فشل رفع الملفات: {reason}',
    expired: 'تجديد الاشتراك يعيد إمكانية رفع الملفات',
    gallery: 'الاختيار من المعرض',
    unavailable: 'لا يمكن العرض',
  },
}

export const drive: L['drive'] = {
  attach: 'إرفاق ملف من Drive',
  expired: 'تجديد الاشتراك يعيد إمكانية إرفاق الملفات',
  empty: 'لا توجد ملفات من Drive مرفقة بهذا العميل المحتمل.',
  suggested: 'مقترح: وُجدت في Drive حسب بيانات العميل المحتمل',
  attached: 'تم إرفاق الملف بالعميل المحتمل',
  attachedMany: {
    zero: 'تم إرفاق {count} ملف',
    one: 'تم إرفاق ملف واحد',
    two: 'تم إرفاق ملفين',
    few: 'تم إرفاق {count} ملفات',
    many: 'تم إرفاق {count} ملفًا',
    other: 'تم إرفاق {count} ملف',
  },
  attachFailed: 'فشل الإرفاق. حاول مرة أخرى.',
  detached: 'تمت إزالة الملف',
  detachFailed: 'فشلت الإزالة. حاول مرة أخرى.',
  open: 'فتح',
  detach: 'إزالة',
  repick: 'إرفاق من جديد',
  repicked: 'تم تحديث الملف من Drive',
  repickFailed: 'فشل التحديث. حاول مرة أخرى.',
  loading: 'جارٍ التحميل…',
  attachOne: 'إرفاق',
  attaching: 'جارٍ الإرفاق…',
  dialog: {
    label: 'إرفاق ملف من Google Drive',
    title: 'إرفاق ملف من Google Drive',
    intro: 'ابحث في ملفاتك على Drive واختر الملف لإرفاقه بالعميل المحتمل.',
    searchPlaceholder: 'ابحث عن ملف بالاسم أو المحتوى…',
    minChars: 'اكتب حرفين على الأقل',
    noResults: 'لم يتم العثور على ملفات',
    close: 'إغلاق',
  },
  picker: {
    intro: 'اختر ملفًا من Drive لإرفاقه بالعميل المحتمل.',
    pick: 'اختيار ملف من Drive',
    unconfigured: 'أداة Picker غير مُعدّة.',
    failed: 'تعذّر فتح أداة Picker. حاول مرة أخرى.',
  },
}
