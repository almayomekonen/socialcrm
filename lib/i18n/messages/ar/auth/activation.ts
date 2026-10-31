import type { Messages } from '../../../translate'

type A = Messages['auth']

/** No emoji outside Hebrew (CLAUDE.md §12); the Hebrew heading keeps its existing one. */
export const activation: A['activation'] = {
  dialog: 'تفعيل SocialCRM',
  video: 'فيديو تعريفي عن SocialCRM',
  ready: {
    heading: 'مساحة عملك جاهزة',
    connected: 'تم ربط حساب Meta الخاص بك بنجاح.',
    moving: 'ننقلك الآن إلى النظام...',
  },
  step: 'الخطوة 2 من 2',
  done: 'اكتمل',
  waiting: { heading: 'عند إتمام هذه الخطوة، سيصل كل عميل محتمل جديد إلى هنا تلقائيًا.' },
  start: 'ابدأ في استقبال العملاء المحتملين',
  connecting: 'جارٍ الاتصال…',
  linking: 'جارٍ الربط…',
  trust: { secure: 'اتصال آمن عبر Meta', ownLeads: 'الوصول إلى عملائك المحتملين فقط', yourData: 'بياناتك تبقى ملكك' },
  finishing: 'جارٍ إنهاء الاتصال…',
  select: { heading: 'أي صفحة تريد ربطها؟' },
  subscribing: 'جارٍ ربط مصدر عملائك المحتملين…',
  completed: {
    heading: 'مساحة عملك جاهزة.',
    body: 'من الآن فصاعدًا، سيصل كل عميل محتمل جديد إلى هنا تلقائيًا.',
    instruction: 'تابع على الحاسوب للحصول على التجربة الكاملة.',
    secondary: 'هل أنت أمام الحاسوب الآن؟ ادخل إلى getsocialcrm.com',
  },
  failed: { heading: 'لم يكتمل الاتصال.', body: 'يمكنك المحاولة مرة أخرى لاستقبال العملاء المحتملين تلقائيًا.' },
  retry: 'حاول مرة أخرى',
}

export const handoff: A['handoff'] = {
  heading: 'يعمل SocialCRM بأفضل شكل على الحاسوب.',
  body: 'النظام مصمَّم للشاشة الكبيرة، لإدارة العملاء المحتملين والمحادثات والذكاء الاصطناعي في مكان واحد.',
  share: 'مشاركة الرابط',
  shareText: 'الدخول إلى نظام SocialCRM',
  soon: 'تطبيق للهاتف — قيد التطوير',
  support: 'تحتاج إلى مساعدة؟ تحدّث إلينا',
}
