import type { Messages } from '../../translate'

export const language: Messages['language'] = {
  pageTitle: 'لغة الواجهة',
  intro:
    'لغة القوائم والأزرار والإعدادات. لا تُترجَم الأسماء والرسائل ومحتوى العملاء المحتملين، وتبقى كما كُتبت تمامًا.',
  personalTitle: 'لغتي',
  personalHelp: 'تنطبق عليك وحدك، على كل جهاز تسجّل الدخول منه.',
  personalLabel: 'لغة واجهتك',
  useAgencyDefault: 'اللغة الافتراضية للنشاط التجاري ({language})',
  effectiveFromUser: 'المعروض الآن: {language}، حسب اختيارك الشخصي',
  effectiveFromAgency: 'المعروض الآن: {language}، حسب اللغة الافتراضية للنشاط التجاري',
  effectiveFromDefault: 'المعروض الآن: {language}، اللغة الافتراضية للنظام',
  savePersonal: 'حفظ اللغة',
  savedPersonal: 'تم تحديث اللغة',
  agencyTitle: 'اللغة الافتراضية للنشاط التجاري',
  agencyHelp:
    'يرى المندوبون الذين لم يختاروا لغة شخصية هذه اللغة. أما المندوب الذي اختار لغة شخصية فيستمر في رؤية اللغة التي اختارها.',
  agencyLabel: 'اللغة الافتراضية',
  agencyChangePreview: 'بعد الحفظ، سيرى المندوبون الذين ليست لديهم لغة شخصية الواجهة بـ: {to} (بدلًا من {from}).',
  saveAgency: 'تحديث اللغة الافتراضية',
  savedAgency: 'تم تحديث اللغة الافتراضية للنشاط التجاري',
  saveError: 'تعذّر حفظ اللغة. يُرجى المحاولة مرة أخرى.',
}
