import type { Messages } from '../../../translate'

type B = Messages['billing']

export const paymentMethod: B['paymentMethod'] = {
  cash: 'نقدًا',
  bank_transfer: 'تحويل مصرفي',
  credit_card: 'بطاقة ائتمان',
  check: 'شيك',
  digital: 'وسيلة دفع رقمية',
  other_method: 'أخرى',
}

export const issueError: B['issueError'] = {
  external_issuer: 'يصدر هذا النشاط التجاري مستنداته عبر SmartBee، لذلك لا يمكن إصدارها هنا',
  payment_exceeds_total: 'لا يمكن أن يكون المبلغ المستلم أعلى من إجمالي المستند',
  payment_incomplete: 'يجب استكمال بيانات الدفع',
  issuer_identity_incomplete: 'يجب استكمال بيانات النشاط التجاري',
  no_permission: 'ليست لديك صلاحية الإصدار',
  lead_not_found: 'لم يتم العثور على العميل المحتمل',
  invoice_not_found: 'لم يتم العثور على الفاتورة',
  not_draft: 'سبق إصدار الفاتورة',
  empty_lines: 'يجب إضافة بند واحد على الأقل',
  profile_archived: 'ملف الفوترة غير نشط',
  empty_legal_name: 'يجب إدخال اسم للفوترة',
  zero_total: 'يجب أن يكون إجمالي المستند أكبر من صفر',
  line_not_found: 'لم يتم العثور على أحد البنود',
  invalid_input: 'بيانات غير صالحة',
  failed: 'تعذّر إصدار الفاتورة',
}

export const picker: B['picker'] = {
  trigger: 'اختر عميلًا',
  search: 'البحث عن عميل...',
  none: 'لا توجد نتائج',
  billed: 'تمت فوترتهم',
  recent: 'العملاء المحتملون الأخيرون',
  create: 'إنشاء عميل جديد',
  noName: 'بدون اسم',
  invoices: {
    zero: '{count} فاتورة',
    one: 'فاتورة واحدة',
    two: 'فاتورتان',
    few: '{count} فواتير',
    many: '{count} فاتورة',
    other: '{count} فاتورة',
  },
  current: 'الحالي',
}
