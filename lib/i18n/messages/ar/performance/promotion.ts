import type { Messages } from '../../../translate'

export const promotion: Messages['performance']['promotion'] = {
  title: 'الحملات',
  detailTitle: 'تفاصيل الحملة',
  heading: 'الحملات',
  empty: {
    title: 'لا توجد حملات بعد',
    line1: 'الحملات هي مسابقات مبيعات داخلية بين المندوبين.',
    line2: 'ينشئ المدير حملة بأهداف وجوائز، وترى هنا تقدّمك.',
  },
  past: 'الحملات السابقة',
  notFound: 'لم يُعثر على الحملة',
  loadError: 'خطأ في تحميل الحملة',
  noData: 'لا توجد بيانات لهذه الحملة بعد',
  notIncluded: 'أنت غير مشمول في هذه الحملة',
  period: 'فترة الحملة: {start} - {end}',
  managerCampaign: 'حملة للمدير',
  rules: 'اللائحة:',
  totalCommission: 'إجمالي العمولة',
  deals: 'الصفقات',
  filterReps: 'تصفية المندوبين...',
  resetFilter: 'إعادة ضبط التصفية',
  filterRepsButton: 'تصفية المندوبين',
  column: { rep: 'المندوب', team: 'الفريق' },
}
