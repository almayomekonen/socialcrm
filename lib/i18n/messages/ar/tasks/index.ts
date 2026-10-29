import type { Messages } from '../../../translate'

type L = Messages['tasks']

/** "מעקב" here is a TASK (glossary D1.3 flags): مهمة, never متابعة. */
export const tasks: L = {
  page: {
    title: 'المهام',
    description: 'جميع مهام العملاء المحتملين',
    actions: 'الإجراءات',
    reps: 'المندوبون',
    filter: 'تصفية',
    clearFilter: 'مسح عوامل التصفية',
    create: 'مهمة جديدة',
    empty: 'لا توجد مهام بعد',
    count: {
      zero: 'لا مهام',
      one: 'مهمة واحدة',
      two: 'مهمتان',
      few: '{count} مهام',
      many: '{count} مهمة',
      other: '{count} مهمة',
    },
    active: {
      zero: 'لا مهام نشطة',
      one: 'مهمة نشطة واحدة',
      two: 'مهمتان نشطتان',
      few: '{count} مهام نشطة',
      many: '{count} مهمة نشطة',
      other: '{count} مهمة نشطة',
    },
    done: {
      zero: 'لا مهام مكتملة',
      one: 'مهمة مكتملة واحدة',
      two: 'مهمتان مكتملتان',
      few: '{count} مهام مكتملة',
      many: '{count} مهمة مكتملة',
      other: '{count} مهمة مكتملة',
    },
    overdue: {
      zero: 'لا مهام متأخرة',
      one: 'مهمة متأخرة واحدة',
      two: 'مهمتان متأخرتان',
      few: '{count} مهام متأخرة',
      many: '{count} مهمة متأخرة',
      other: '{count} مهمة متأخرة',
    },
    header: {
      title: 'المهمة',
      status: 'الحالة',
      clientName: 'العميل المحتمل',
      completed: 'مكتملة',
      userName: 'المندوب',
      dueDate: 'تاريخ الاستحقاق',
      createdAt: 'تاريخ الإنشاء',
      updatedAt: 'آخر نشاط',
    },
  },
  files: {
    title: 'الملفات',
    leadFilter: 'العميل المحتمل',
    empty: 'لا توجد ملفات بعد',
    clientNameHeader: 'العميل المحتمل',
  },
}
