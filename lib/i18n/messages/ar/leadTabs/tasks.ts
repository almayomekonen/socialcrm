import type { Messages } from '../../../translate'

type L = Messages['leadTabs']

/** "מעקב" here is a TASK (glossary D1.3 flags): مهمة, never متابعة. */
export const tasks: L['tasks'] = {
  status: {
    new: 'جديدة',
    inProgress: 'قيد المعالجة',
    awaitingReply: 'بانتظار الرد',
    reassigned: 'نُقلت إلى مندوب آخر',
    notRelevant: 'غير ذات صلة',
    notInterested: 'غير مهتم',
    closed: 'مغلقة',
    handled: 'اكتملت المعالجة',
  },
  table: {
    statusFilter: 'الحالة',
    handlerFilter: 'المسؤول',
    create: 'إنشاء مهمة',
    header: {
      title: 'العنوان',
      status: 'الحالة',
      userName: 'المسؤول',
      completed: 'مكتملة',
      dueDate: 'تاريخ الاستحقاق',
      createdAt: 'تاريخ الإنشاء',
      updatedAt: 'آخر نشاط',
    },
  },
  form: {
    title: 'إنشاء مهمة جديدة',
    leadLabel: 'عميل محتمل',
    leadPlaceholder: 'اختر عميلًا محتملًا',
    taskTitleLabel: 'عنوان المهمة',
    taskTitlePlaceholder: 'مثال: متابعة عرض السعر',
    create: 'إنشاء مهمة',
    templateLabel: 'أو اختر من قالب',
    createFromTemplate: 'إنشاء مهمة من قالب',
    titleRequired: 'أدخل عنوان المهمة',
    leadRequired: 'اختر عميلًا محتملًا',
  },
  detail: {
    markDone: 'تحديد كمنجزة',
    unmarkDone: 'إلغاء التحديد',
    repPlaceholder: 'المندوب',
    statusPlaceholder: 'الحالة',
    titleLabel: 'العنوان',
    titleRequired: 'أدخل العنوان',
    edit: 'تعديل',
    delete: 'حذف',
  },
  notes: {
    title: 'الملاحظات',
    placeholder: 'أضف تحديثًا: ماذا حدث مع العميل المحتمل؟',
    required: 'أدخل نص الملاحظة',
    add: 'إضافة تحديث',
    deleteNote: 'حذف الملاحظة',
  },
}
