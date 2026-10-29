import type { Messages } from '../../../translate'

type D = Messages['deals']

export const status: D['status'] = {
  new: 'جديد',
  proposal: 'تم إرسال العرض',
  negotiating: 'قيد التفاوض',
  awaitingPayment: 'بانتظار الدفع',
  paid: 'مدفوع',
  cancelled: 'ملغى',
  all: 'الكل',
}

export const branch: D['branch'] = {
  total: 'الإجمالي المرجّح',
  services: 'خدمات',
  products: 'منتجات',
  courses: 'دورات',
  subscriptions: 'اشتراكات',
  packages: 'باقات',
  consulting: 'استشارات',
  others: 'أخرى',
}

export const company: D['company'] = { none: 'بدون مورّد', others: 'أخرى' }

export const productType: D['productType'] = { transfer: 'تحويل', monthly: 'دفعة شهرية', oneTime: 'دفعة لمرة واحدة' }

export const product: D['product'] = {
  socialMedia: 'إدارة وسائل التواصل الاجتماعي',
  website: 'بناء موقع إلكتروني',
  seo: 'SEO',
  ppc: 'PPC',
  content: 'محتوى تسويقي',
  physical: 'منتج مادي',
  digital: 'منتج رقمي',
  software: 'برمجيات',
  onlineCourse: 'دورة عبر الإنترنت',
  workshop: 'ورشة عمل',
  coaching: 'مرافقة شخصية',
  monthlySub: 'اشتراك شهري',
  yearlySub: 'اشتراك سنوي',
  basicPackage: 'باقة أساسية',
  advancedPackage: 'باقة متقدمة',
  premiumPackage: 'باقة مميزة',
  businessConsulting: 'استشارات أعمال',
  marketingConsulting: 'استشارات تسويقية',
  strategyConsulting: 'استشارات استراتيجية',
  others: 'أخرى',
}

export const action: D['action'] = { sale: 'بيع', join: 'انضمام', all: 'الكل' }

export const dateRange: D['dateRange'] = {
  all: 'كل التواريخ',
  thisMonth: 'الشهر الحالي',
  lastMonth: 'الشهر السابق',
  thisWeek: 'الأسبوع الحالي',
  lastWeek: 'الأسبوع السابق',
  thisYear: 'السنة الحالية',
  lastYear: 'السنة السابقة',
  custom: 'مخصص',
}

export const leadSource: D['leadSource'] = { website: 'موقع إلكتروني', referral: 'توصية', paid: 'إعلانات ممولة', organic: 'عضوي' }
