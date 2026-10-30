import type { Messages } from '../../../translate'

type L = Messages['education']

export const chrome: L['chrome'] = {
  progress: '{current} من {total}',
  next: 'التالي',
  prev: 'رجوع',
  done: 'فهمت',
  skip: 'تخطٍّ',
  fallbackLabel: 'جولة إرشادية',
}

export const intro: L['intro'] = {
  title: 'مرحبًا بك في SocialCRM',
  description: 'هل تريد جولة قصيرة في النظام؟',
  start: 'ابدأ الجولة',
  later: 'ربما لاحقًا',
}

export const help: L['help'] = {
  body: 'جولة قصيرة، أو أدلة، أو الإبلاغ عن مشكلة.',
  overview: 'أرني كيف يعمل النظام',
  pipeline: 'جولة في العملاء المحتملين',
  guides: 'الأدلة',
  problem: 'لديّ مشكلة',
  copilotHint: 'J + ⌘  المساعد الذكي',
}

export const leadsEmpty: L['leadsEmpty'] = {
  title: 'لا يوجد عملاء محتملون حاليًا',
  body: 'لبدء جولة العملاء المحتملين، أضف عميلًا محتملًا واحدًا على الأقل.',
  dismiss: 'فهمت',
}
