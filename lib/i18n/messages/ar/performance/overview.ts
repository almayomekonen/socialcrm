import type { Messages } from '../../../translate'

type P = Messages['performance']

export const page: P['page'] = {
  title: 'الأداء',
  description: 'أداء الصفقات',
  monthsTitle: 'ملخص الصفقات حسب الشهر',
  monthsDescription: 'ملخص صفقات المندوبين حسب الشهر',
  companiesTitle: 'ملخص الصفقات حسب المورّد',
  companiesDescription: 'ملخص صفقات المندوبين حسب المورّد',
  agentsDenied: 'غير مسموح',
  teamsDenied: 'ليست لديك صلاحية لعرض ملخص الفرق',
}

export const nav: P['nav'] = { summary: 'الملخص', reps: 'المندوبون', months: 'الأشهر', ads: 'الإعلانات' }

export const overview: P['overview'] = {
  revenuePaid: 'إجمالي الإيرادات (مدفوع)',
  closedDeals: 'صفقات مغلقة',
  pipeline: 'المسار',
  inProgress: 'صفقات قيد التنفيذ',
  compare: 'مقارنة الصفقات',
  pieCommission: 'العمولة',
  pieIncome: 'الدخل',
  pieDeals: 'الصفقات',
  total: 'الإجمالي',
  annualPace: 'الوتيرة السنوية',
  goals: {
    categories: 'الفئات',
    monthDeals: 'صفقات هذا الشهر',
    monthlyGoal: 'الهدف الشهري',
    progress: 'تحقيق الهدف',
    annualPace: 'الوتيرة السنوية',
  },
}

export const report: P['report'] = {
  empty: 'لا توجد بيانات لعرضها',
  column: { rep: 'المندوب', month: 'الشهر', team: 'الفريق', company: 'الشركة' },
}
