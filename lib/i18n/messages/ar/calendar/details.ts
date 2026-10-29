import type { Messages } from '../../../translate'

type L = Messages['calendar']

export const details: L['details'] = {
  time: 'الوقت',
  lead: 'العميل المحتمل',
  viewLead: 'عرض العميل المحتمل ←',
  syncError: 'تفاصيل الفشل: ',
  openMeet: 'فتح Google Meet',
  marking: 'جارٍ التحديد…',
  markCompleted: 'تحديد كمكتمل',
  markNoShow: 'تحديد كعدم حضور',
  close: 'إغلاق',
  retrying: 'جارٍ المزامنة…',
  retry: 'إعادة محاولة المزامنة',
  edit: 'تعديل الاجتماع',
  cancelling: 'جارٍ الإلغاء…',
  cancel: 'إلغاء الاجتماع',
  cancelConfirm: 'هل تريد إلغاء الاجتماع «{title}»؟\nسيتلقى المشاركون إشعارًا بالإلغاء.',
}

export const outcome: L['outcome'] = {
  completed: 'تم التحديد كمكتمل',
  noShow: 'تم التحديد كعدم حضور',
  failed: 'فشل تحديث الاجتماع',
  unexpected: 'حدث خطأ. حاول مرة أخرى.',
  leadUpdated: 'تم تحديث حالة العميل المحتمل',
  leadUpdateFailed: 'فشل تحديث العميل المحتمل',
  error: {
    invalid_input: 'إدخال غير صالح',
    not_found: 'لم يتم العثور على الاجتماع',
    not_owner: 'لا تملك صلاحية تحديث هذا الاجتماع',
    already_cancelled: 'تم إلغاء الاجتماع بالفعل',
    already_completed: 'تم تحديد الاجتماع كمكتمل بالفعل',
    already_no_show: 'تم تحديد الاجتماع كعدم حضور بالفعل',
  },
  nudge: 'حددت الاجتماع كمكتمل. نوصي بتحديث حالة العميل المحتمل إلى',
  notNow: 'ليس الآن',
  updating: 'جارٍ التحديث…',
  apply: 'تحديث الحالة إلى {status}',
}

export const badge: L['badge'] = {
  sync: { pending: 'جارٍ المزامنة…', synced: 'متزامن', failed: 'فشلت المزامنة', reauth_required: 'يلزم إعادة الربط' },
  outcome: { completed: 'مكتمل', no_show: 'لم يحضر', cancelled: 'ملغى' },
}
