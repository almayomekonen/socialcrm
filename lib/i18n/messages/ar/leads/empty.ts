import type { Messages } from '../../../translate'

type L = Messages['leads']

export const empty: L['empty'] = {
  noMatchLeads: 'لم يتم العثور على عملاء محتملين مطابقين',
  noMatchCustomers: 'لم يتم العثور على عملاء مطابقين',
  searchNarrowsLeads: 'البحث الحالي يضيّق القائمة. عملاؤك المحتملون ما زالوا في النظام ولم يُفقدوا.',
  searchNarrowsCustomers: 'البحث الحالي يضيّق القائمة. عملاؤك ما زالوا في النظام ولم يُفقدوا.',
  filterNarrowsLeads: 'التصفية الحالية تضيّق القائمة. عملاؤك المحتملون ما زالوا في النظام ولم يُفقدوا.',
  filterNarrowsCustomers: 'التصفية الحالية تضيّق القائمة. عملاؤك ما زالوا في النظام ولم يُفقدوا.',
  showAllLeads: 'عرض جميع العملاء المحتملين',
  showAllCustomers: 'عرض جميع العملاء',
  noLeadsYet: 'لا يوجد عملاء محتملون بعد',
  noCustomersYet: 'لا يوجد عملاء بعد',
  leadsHint: 'اربط فيسبوك أو أضف عميلًا محتملًا يدويًا',
  customersHint: 'يمكنك البدء بإنشاء عميل محتمل أو رفع ملف',
  addLead: 'إضافة عميل محتمل',
  uploadLeads: 'رفع العملاء المحتملين',
  tabEmpty: 'لا يوجد عملاء محتملون في هذه الحالة حاليًا',
  showInStatus: 'عرض العملاء المحتملين في «{status}» ({n})',
  addManually: 'إضافة عميل محتمل يدويًا',
  or: ' أو ',
  uploadFile: 'رفع ملف عملاء محتملين',
  loading: 'جارٍ التحميل…',
}

export const page: L['page'] = {
  leadsTitle: 'العملاء المحتملون',
  leadsDescription: 'جميع العملاء المحتملين',
  clientsTitle: 'العملاء',
  clientsDescription: 'جميع العملاء',
  clientsExplainer: 'العملاء هم عملاء محتملون أغلقوا صفقة',
}
