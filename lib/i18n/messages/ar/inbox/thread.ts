import type { Messages } from '../../../translate'

type I = Messages['inbox']

export const header: I['header'] = {
  title: 'محادثة واتساب',
  lastActivity: 'آخر نشاط {date}',
  needsReply: 'تتطلب ردًا',
  repReplied: 'ردّ المندوب آخرًا',
  call: 'اتصال',
  leadCard: 'ملف العميل المحتمل',
}

export const conversation: I['conversation'] = {
  emptyTitle: 'لا توجد رسائل واتساب بعد',
  emptyLead: 'عندما يكتب العميل المحتمل، ستظهر الرسائل هنا.',
  emptyContact: 'عندما تصل رسالة، ستظهر هنا.',
  messages: 'رسائل المحادثة',
  inbound: 'رسالة واردة',
  outbound: 'رسالة مُرسلة من النظام',
  newMessage: 'وصلت رسالة واتساب جديدة',
}

export const status: I['status'] = {
  sent: 'أُرسلت — بانتظار تأكيد التسليم',
  delivered: 'تم التسليم',
  read: 'تمت القراءة',
  failed: 'لم تُرسل',
}

export const failure: I['failure'] = {
  window_expired: 'لم تُرسل الرسالة — مرّت أكثر من 24 ساعة منذ أن كتب العميل المحتمل. يمكنك الاتصال به.',
  recipient: 'لم تُرسل الرسالة — هذا الرقم غير نشط على واتساب.',
  account: 'لم تُرسل الرسالة — إرسال الرسائل معطّل حاليًا. يلزم التحقق من إعدادات الحساب.',
  generic: 'لم تُرسل الرسالة. حاول مرة أخرى.',
}

export const tooltip: I['tooltip'] = {
  window_expired: {
    title: 'تعذّر إرسال الرسالة',
    explanation: 'يسمح واتساب بإرسال رسالة عادية خلال 24 ساعة فقط من آخر رسالة من العميل.',
    action: 'للتواصل معه الآن، يمكنك الاتصال به.',
  },
  recipient: {
    title: 'تعذّر إرسال الرسالة',
    explanation: 'يبدو أن هذا الرقم غير متاح على واتساب.',
    action: 'تحقق من صحة الرقم أو تواصل مع العميل بطريقة أخرى.',
  },
  account: {
    title: 'تعذّر إرسال الرسائل حاليًا',
    explanation: 'لا يسمح واتساب حاليًا بإرسال الرسائل من الحساب المتصل.',
    action: 'تحقق من حساب واتساب المتصل بـ SocialCRM.',
  },
  generic: {
    title: 'لم تُرسل الرسالة',
    explanation: 'لم يتمكن واتساب من إرسال الرسالة.',
    action: 'يمكنك المحاولة مرة أخرى بعد لحظات.',
  },
}

export const reaction: I['reaction'] = {
  list: 'التفاعلات مع الرسالة',
  sent: 'تفاعل مُرسل',
  received: 'تفاعل وارد',
  onEarlier: 'على رسالة سابقة',
}

export const quote: I['quote'] = {
  label: 'اقتباس',
  notFound: 'رد على رسالة سابقة',
}

export const kind: I['kind'] = {
  image: 'صورة',
  video: 'مقطع فيديو',
  document: 'مستند',
  audio: 'رسالة صوتية',
  sticker: 'ملصق',
  location: 'موقع',
  contacts: 'جهة اتصال',
  message: 'رسالة',
}

export const media: I['media'] = {
  unsupported: 'نوع الرسالة هذا غير مدعوم بعد',
  unnamedFile: 'ملف من واتساب',
  unnamedAudio: 'تسجيل من واتساب',
  kindImage: 'صورة',
  kindAudio: 'تسجيل',
  kindVideo: 'فيديو',
  imageAlt: 'صورة مستلمة على واتساب',
  showImage: 'عرض الصورة {name}',
  openFile: 'فتح الملف {name}',
  open: 'فتح',
  play: 'تشغيل التسجيل',
  pause: 'إيقاف التسجيل مؤقتًا',
  seek: 'الموضع في التسجيل',
  viewer: 'عارض الصور',
}
