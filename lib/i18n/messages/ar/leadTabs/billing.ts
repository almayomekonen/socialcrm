import type { Messages } from '../../../translate'

type L = Messages['leadTabs']

export const billing: L['billing'] = {
  title: 'الفوترة',
  create: 'إنشاء مستند',
  header: {
    document: 'المستند',
    status: 'الحالة',
    amount: 'المبلغ',
    issuedAt: 'تاريخ الإصدار',
    dueAt: 'مستحق حتى',
  },
  edit: 'تعديل',
  view: 'عرض',
  empty: {
    title: 'لا توجد فواتير لهذا العميل المحتمل',
    canCreate: 'ابدأ بإصدار أول فاتورة',
    noPermission: 'ليست لديك صلاحية إصدار الفواتير',
  },
  docState: { draft: 'مسودة', issued: 'صادرة', voided: 'ملغاة', replaced: 'مستبدلة' },
  fulfillState: { open: 'بانتظار الدفع', partial: 'مدفوعة جزئيًا', paid: 'مدفوعة', overdue: 'متأخرة', written_off: 'مشطوبة' },
  draftNumber: 'مسودة بدون رقم',
  identity: '{kind} {number}',
  kindShort: { invoice: 'فاتورة', invoice_receipt: 'فاتورة/إيصال' },
  picker: {
    label: 'اختيار نوع المستند',
    title: 'أي مستند تريد إصداره؟',
    help: 'لست متأكدًا من نوع المستند الذي تحتاج إلى إصداره؟',
    soon: 'قريبًا',
    kind: {
      invoice_receipt: 'فاتورة/إيصال',
      deal_invoice: 'فاتورة مبدئية',
      payment_request: 'طلب دفع',
      order: 'طلبية (دفتر الطلبيات)',
      quote: 'عرض سعر',
      credit_note: 'إشعار دائن',
    },
  },
}
