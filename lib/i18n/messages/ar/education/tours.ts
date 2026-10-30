import type { Messages } from '../../../translate'

/** "מעקב" in the lead tour is the follow-up control: «المتابعة». Arrows point the reading direction (←). */
export const tours: Messages['education']['tours'] = {
  overview: {
    today: { title: 'اليوم', description: 'هنا ترى ما يحتاج إلى انتباهك الآن.' },
    leads: { title: 'العملاء المحتملون', description: 'جميع عملائك المحتملين، من كل القنوات، في مكان واحد.' },
    clients: { title: 'العملاء', description: 'العملاء المحتملون المغلقون — تابع إدارتهم من هنا.' },
    inbox: { title: 'المحادثات', description: 'هنا تدير محادثاتك مع العملاء المحتملين.' },
    deals: { title: 'الصفقات', description: 'هنا تتابع الصفقات الجارية.' },
    performance: { title: 'الأداء', description: 'هنا ترى كيف يتقدّم العمل.' },
    tasks: { title: 'المهام', description: 'هنا ترى ما يجب إنجازه.' },
    calendar: { title: 'الاجتماعات', description: 'هنا ترى الاجتماعات القادمة.' },
    settings: { title: 'الإعدادات', description: 'هنا تربط واتساب وفيسبوك وتضبط إعدادات أخرى.' },
    header: { title: 'الشريط العلوي', description: 'هنا تجد الإجراءات والأدوات المتاحة لك من أي مكان في النظام.' },
    copilot: {
      title: 'المساعد الذكي',
      description: 'تحتاج إلى مساعدة؟ اسأل المساعد الذكي وسيساعدك على فهم ما يجب فعله وكيف تتقدّم.',
    },
    notifications: { title: 'الإشعارات', description: 'هنا ترى الأمور التي تحتاج إلى انتباهك.' },
    end: { title: 'هذا كل شيء، أنت الآن جاهز', description: 'تعرّفت على المناطق الرئيسية في SocialCRM. يمكنك البدء بالعمل من هنا.' },
  },
  pipeline: {
    table: { title: 'القائمة', description: 'هنا جميع عملائك المحتملين، من كل القنوات، ومن هنا يبدأ العمل اليومي.' },
    statuses: { title: 'الحالات', description: 'تساعدك الحالة على معرفة من هو جديد، ومن قيد المعالجة، ومن يحتاج إلى انتباهك.' },
    open: {
      title: 'فتح عميل محتمل',
      description: 'وجدت عميلًا محتملًا تعمل عليه؟ افتحه لترى التفاصيل وتتواصل معه وتحدّث الإجراء التالي.',
    },
    add: { title: 'عميل محتمل جديد', description: 'يمكنك إضافة العملاء المحتملين يدويًا، أو استيرادهم، أو استقبالهم من القنوات المتصلة بـ SocialCRM.' },
    end: { title: 'هذه هي الفكرة كلها', description: 'ابحث عن عميل محتمل ← افتحه ← اعمل عليه ← انتقل إلى العميل المحتمل التالي.' },
  },
  lead: {
    status: { title: 'حالة العميل المحتمل', description: 'حدّثها بعد كل مكالمة حتى لا يفوتك شيء.' },
    followUp: { title: 'المتابعة', description: 'حدّد موعد العودة إليه — وسيذكّرك النظام في الوقت المناسب.' },
  },
  copilot: {
    trigger: { title: 'المساعد الذكي', description: 'اسأل من يحتاج إليك الآن. لا يرسل أي رسالة دون موافقتك.' },
  },
  whatsapp: {
    section: { title: 'واتساب', description: 'اربط واتساب هنا، في الإعدادات ← التكاملات.' },
    connect: { title: 'الربط', description: 'ابدأ ربط واتساب من هذا الزر.' },
  },
  facebook: {
    section: { title: 'فيسبوك', description: 'اربط فيسبوك هنا، في الإعدادات ← التكاملات.' },
    connect: { title: 'الربط', description: 'ابدأ ربط فيسبوك من هذا الزر.' },
  },
}
