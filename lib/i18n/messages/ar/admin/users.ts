import type { Messages } from '../../../translate'

export const users: Messages['admin']['users'] = {
  title: 'تعديل المستخدمين',
  invitationsTitle: 'الدعوات',
  allRoles: 'كل الأدوار',
  role: { AGNT: 'مندوب مبيعات', MNGR: 'مدير', OFFICE: 'العمليات', ADMIN: 'مسؤول', GM: 'مدير عام', EXT: 'شريك خارجي' },
  col: {
    name: 'الاسم',
    role: 'الدور',
    email: 'البريد الإلكتروني',
    phone: 'الهاتف',
    suspended: 'موقوف',
    gavePerm: 'الصلاحيات الممنوحة',
    gotPerm: 'الصلاحيات المستلمة',
    updatedAt: 'تاريخ التحديث',
    createdAt: 'تاريخ الإنشاء',
    id: 'المعرّف',
    edit: 'تعديل',
  },
  editRep: 'تعديل المندوب',
  edit: {
    newUser: 'إضافة مستخدم',
    transfer: 'نقل الصفقات إلى مندوب آخر',
    deleteRep: 'حذف المندوب',
    personal: 'البيانات الشخصية',
    firstName: 'الاسم الأول',
    lastName: 'اسم العائلة',
    email: 'البريد الإلكتروني',
    emailTitle: 'أدخل عنوان بريد إلكتروني صالحًا (مثال: user@example.com)',
    phone: 'رقم الهاتف',
    role: 'الدور',
    suspended: 'الحساب موقوف',
    perms: 'الصلاحيات',
    reps: 'المندوبون',
    save: 'حفظ البيانات',
    officeRefused: 'لا يمكن تغيير المندوب إلى العمليات لأن لديه صفقات. انقل الصفقات إلى مندوب آخر وحاول مرة أخرى.',
    deleteRefused: `لم يتم حذف {name} لأن هناك صفقات باسمه.
احذف الصفقات
أو انقلها إلى مندوب آخر
وحاول مرة أخرى`,
    deleteLinked: 'لا يمكن حذف المندوب لأن هناك عملاء محتملين مرتبطين به',
    deleteConfirm: 'هل تريد حذف {name}؟',
  },
}

export const invitations: Messages['admin']['invitations'] = {
  col: {
    firstName: 'الاسم الأول',
    lastName: 'اسم العائلة',
    email: 'البريد الإلكتروني',
    role: 'الدور',
    phone: 'الهاتف',
    createdAt: 'تاريخ الإنشاء',
    expiresAt: 'تاريخ الانتهاء',
    status: 'الحالة',
    delete: 'حذف',
  },
  deleteLabel: 'حذف الدعوة',
  invite: 'دعوة مستخدم',
  deleteConfirm: 'هل تريد حذف الدعوة؟',
  expired: 'منتهية الصلاحية',
  pending: 'بانتظار القبول',
  genericError: 'حدث خطأ، حاول مرة أخرى',
  existing: 'هذا المستخدم موجود في النظام بالفعل، لذا لا حاجة إلى دعوة. لجعله مندوبًا، غيّر دوره في جدول المستخدمين أعلاه.',
  form: { title: 'مستخدم جديد', firstName: 'الاسم الأول', lastName: 'اسم العائلة', email: 'البريد الإلكتروني', phone: 'الهاتف', role: 'الدور', send: 'إرسال الدعوة' },
  server: {
    forbidden: 'لا توجد صلاحية',
    badRole: 'دور غير صالح',
    sendFailed: 'تعذّر إرسال الدعوة. حاول مرة أخرى.',
    createFailed: 'حدث خطأ أثناء إنشاء الدعوة.',
  },
}

export const teams: Messages['admin']['teams'] = {
  title: 'تعديل الفرق',
  add: 'إضافة فريق',
  empty: 'لا توجد فرق بعد',
  edit: 'تعديل الفريق',
  delete: 'حذف الفريق',
  mngrs: 'المديرون',
  repsCount: 'المندوبون ({count})',
  offices: 'موظفو العمليات',
  deleteConfirm: 'هل تريد حذف الفريق {name}؟',
  form: { name: 'اسم الفريق', mngrs: 'المديرون', reps: 'المندوبون', offices: 'موظفو العمليات', noReps: 'يجب اختيار مندوبين', mngrIsRep: 'لا يمكن أن يكون المدير مندوبًا أيضًا' },
}
