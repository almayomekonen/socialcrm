import type { Messages } from '../../../translate'

type A = Messages['auth']

export const oauth: A['oauth'] = {
  title: 'ربط تطبيق بـ SocialCRM',
  heading: 'ربط {client} بـ SocialCRM',
  signedInAs: 'مسجّل الدخول باسم',
  can: 'سيتمكن {client} من:',
  scope: {
    leads: 'عرض عملائك المحتملين ومتابعاتك والملخص اليومي',
    conversations: 'عرض ملخصات محادثات WhatsApp مع عملائك المحتملين، والرسائل نفسها عند الطلب',
  },
  notGranted:
    'لن يحصل {client} على أرقام الهواتف أو عناوين البريد الإلكتروني، ولن يتمكن من تغيير البيانات، ولن يرسل رسائل WhatsApp.',
  connecting: 'جارٍ ربط {client}…',
  cancelling: 'جارٍ الإلغاء…',
  approve: 'الموافقة على الربط بـ {client}',
  back: 'العودة إلى SocialCRM',
  billing: 'إدارة الاشتراك',
  message: {
    unavailable: 'لا يمكن ربط {client} بهذا الحساب حاليًا.',
    needsAccess: 'لربط {client} يلزم اشتراك نشط أو فترة تجريبية نشطة.',
    notAllowlisted: 'الربط بـ {client} غير متاح في حسابك بعد.',
    expired: 'انتهت صلاحية طلب الربط أو تمت معالجته بالفعل. عُد إلى التطبيق الذي بدأت منه وحاول مرة أخرى.',
  },
}

export const root: A['root'] = {
  chunkReloading: 'يتم تحميل تحديث جديد، جارٍ إعادة التحميل...',
}
