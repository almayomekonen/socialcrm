import type { Messages } from '../../../translate'

type M = Messages['mobileShell']

export const tabs: M['tabs'] = {
  more: 'المزيد',
  badged: {
    zero: '{tab}، لا جديد',
    one: '{tab}، عنصر جديد واحد',
    two: '{tab}، عنصران جديدان',
    few: '{tab}، {count} عناصر جديدة',
    many: '{tab}، {count} عنصرًا جديدًا',
    other: '{tab}، {count} عنصر جديد',
  },
}

export const header: M['header'] = {
  back: 'رجوع',
  lead: 'عميل محتمل',
}

export const more: M['more'] = {
  section: {
    profile: 'الملف الشخصي',
    workspace: 'مساحة العمل',
    business: 'النشاط التجاري',
    system: 'النظام',
    account: 'الحساب',
  },
  subtitle: {
    profile: 'الاسم والصورة والتفضيلات',
    repDetails: 'بيانات الاتصال الخاصة بك',
    integrations: 'واتساب وفيسبوك وإنستغرام',
    teams: 'توزيع المندوبين على الفرق',
    users: 'المندوبون والدعوات',
    business: 'الاسم والشعار وبيانات الاتصال',
    billing: 'الخطة والفواتير والمدفوعات',
    autoResponse: 'الرد التلقائي على واتساب',
    questionnaire: 'حالة الاستبيان واختباره',
    security: 'سجل تسجيل الدخول والخروج',
    system: 'الإعدادات الافتراضية',
    support: 'فتح طلب ومتابعته',
  },
  desktop: {
    title: 'على الحاسوب',
    body: 'الفواتير والتقارير والأتمتة متاحة في نسخة الحاسوب.',
  },
  signedIn: 'تم تسجيل الدخول',
}
