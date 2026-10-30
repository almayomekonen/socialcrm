import type { Messages } from '../../../translate'

type D = Messages['deals']

export const page: D['page'] = {
  title: 'الصفقات',
  description: 'إدارة الصفقات والعملاء المحتملين',
  summary: { revenueMonth: 'إيرادات هذا الشهر', revenueTotal: 'إجمالي الإيرادات', dealsTotal: 'إجمالي الصفقات' },
  formDialog: 'نموذج الصفقة',
}

export const table: D['table'] = {
  header: {
    offrDt: 'تاريخ التواصل',
    clientData: 'العميل',
    status: 'الحالة',
    company: 'المورّد',
    prdct: 'الخدمة',
    userName: 'المندوب',
    amount: 'مبلغ الصفقة',
    saleDt: 'تاريخ الصفقة',
    action: 'النوع',
    handlerName: 'المسؤول',
    leadSource: 'المصدر',
    bizName: 'اسم النشاط التجاري',
    notes: 'ملاحظات',
  },
  actions: 'الإجراءات',
  search: 'البحث عن صفقة',
  deleteSelected: 'حذف ({count})',
  deleteAll: 'حذف الكل ({count})',
  import: 'استيراد الصفقات',
  add: 'إضافة صفقة',
  empty: { title: 'لا توجد صفقات بعد', body: 'للبدء، انتقل إلى العملاء المحتملين وأغلق صفقة', toLeads: 'الانتقال إلى العملاء المحتملين' },
  menu: { delete: 'حذف', edit: 'تعديل', addFavorite: 'إضافة إلى المفضلة' },
  confirmDelete: 'حذف',
  bulkConfirm: {
    zero: 'حذف {count} صفقة؟',
    one: 'حذف صفقة واحدة؟',
    two: 'حذف صفقتين؟',
    few: 'حذف {count} صفقات؟',
    many: 'حذف {count} صفقة؟',
    other: 'حذف {count} صفقة؟',
  },
  deleteOneConfirm: 'هل تريد حذف صفقة {name}؟',
  skipped: {
    zero: 'لم تُحذف {count} صفقة (لا توجد صلاحية أو لم يُعثر عليها)',
    one: 'لم تُحذف صفقة واحدة (لا توجد صلاحية أو لم يُعثر عليها)',
    two: 'لم تُحذف صفقتان (لا توجد صلاحية أو لم يُعثر عليهما)',
    few: 'لم تُحذف {count} صفقات (لا توجد صلاحية أو لم يُعثر عليها)',
    many: 'لم تُحذف {count} صفقة (لا توجد صلاحية أو لم يُعثر عليها)',
    other: 'لم تُحذف {count} صفقة (لا توجد صلاحية أو لم يُعثر عليها)',
  },
  toast: {
    bulkDeleted: 'تم حذف الصفقات',
    deleted: 'تم حذف الصفقة بنجاح',
    statusUpdated: 'تم تحديث الحالة بنجاح',
    favoriteAdded: 'أُضيفت الصفقة إلى المفضلة',
    favoriteRemoved: 'أُزيلت الصفقة من المفضلة',
  },
}

export const group: D['group'] = {
  placeholder: 'الإجراءات',
  statusHead: 'تحديث الحالة',
  deleteHead: 'حذف',
  favoritesHead: 'المفضلة',
  delete: 'حذف الصفقات',
  addFavorite: 'إضافة إلى المفضلة',
  removeFavorite: 'إزالة من المفضلة',
  confirm: {
    delete: 'هل تريد حذف الصفقات المحددة؟',
    addFavorite: 'هل تريد إضافة الصفقات المحددة إلى المفضلة؟',
    removeFavorite: 'هل تريد إزالة الصفقات المحددة من المفضلة؟',
    status: 'هل تريد تغيير حالة الصفقات المحددة إلى {status}؟',
  },
  toast: {
    deleted: 'تم حذف الصفقات بنجاح',
    deleteFailed: 'خطأ، لم تُحذف الصفقات',
    favoritesAdded: 'أُضيفت الصفقات إلى المفضلة',
    favoritesRemoved: 'أُزيلت الصفقات من المفضلة',
    statusUpdated: 'تم تحديث الحالة بنجاح',
  },
}
