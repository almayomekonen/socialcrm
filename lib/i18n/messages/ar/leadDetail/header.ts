import type { Messages } from '../../../translate'

type L = Messages['leadDetail']

export const page: L['page'] = {
  title: 'بيانات العميل المحتمل',
  description: 'جميع بيانات العميل المحتمل',
  notFound: 'لم يتم العثور على هذا العميل المحتمل',
}

export const header: L['header'] = {
  handler: 'المسؤول عن العميل المحتمل:',
  copied: 'تم نسخ {text} إلى الحافظة',
  closeDeal: 'إغلاق الصفقة',
}

export const nav: L['nav'] = {
  summary: 'ملخص العميل المحتمل',
  tasks: 'المهام',
  files: 'الملفات',
  billing: 'الفوترة',
}
