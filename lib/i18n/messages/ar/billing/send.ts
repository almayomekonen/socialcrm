import type { Messages } from '../../../translate'

type B = Messages['billing']

export const send: B['send'] = {
  title: 'إرسال فاتورة',
  kind: { invoice: 'إرسال فاتورة', invoice_receipt: 'إرسال فاتورة/إيصال' },
  intro: 'سيتلقى العميل رسالة بريد إلكتروني تتضمن رابطًا لتنزيل المستند كملف PDF.',
  recipient: 'عنوان البريد الإلكتروني للإرسال',
  showAdvanced: 'خيارات إضافية',
  hideAdvanced: 'إخفاء الخيارات الإضافية',
  message: 'رسالة شخصية (اختياري)',
  messagePlaceholder: 'مرحبًا، مرفق الفاتورة. شكرًا لك!',
  submit: 'إرسال الفاتورة',
  invalidEmail: 'أدخل عنوان بريد إلكتروني صالحًا',
  expired: 'تجديد الاشتراك يعيد إمكانية إرسال الفواتير.',
  sent: 'تم إرسال الفاتورة',
  error: {
    no_permission: 'ليست لديك صلاحية إرسال الفواتير',
    lead_not_found: 'لم يتم العثور على العميل المحتمل',
    invoice_not_found: 'لم يتم العثور على الفاتورة',
    invoice_not_issued: 'لا تزال الفاتورة مسودة',
    pdf_not_ready: 'ملف PDF ليس جاهزًا بعد',
    invalid_email: 'عنوان البريد الإلكتروني غير صالح',
    rate_limited: 'تم إرسال طلب للتو — حاول مجددًا بعد بضع ثوانٍ',
    transport_failed: 'رفضت خدمة البريد الإلكتروني الطلب — راجع السجلات',
    failed: 'تعذّر إرسال الفاتورة',
  },
}
