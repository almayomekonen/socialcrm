import type { Messages } from '../../../translate'

type L = Messages['leadDetail']

export const intelligence: L['intelligence'] = {
  title: 'ملخص ذكي',
  unavailable: 'المساعد الذكي غير متاح حاليًا. حاول مرة أخرى بعد دقيقة.',
  confidence: { high: 'ثقة عالية', medium: 'ثقة متوسطة', low: 'ثقة منخفضة' },
  nextAction: 'الإجراء الموصى به',
  basedOn: 'استنادًا إلى: {sources}',
  source: {
    status: 'حالة العميل المحتمل',
    activity: 'النشاط الأخير',
    tasks: 'سجل المهام',
    details: 'بيانات العميل المحتمل',
    origin: 'مصدر العميل المحتمل',
    handling: 'التعامل مع العميل المحتمل',
  },
  skeleton: {
    analyzing: 'جارٍ التحليل…',
    loading: 'جارٍ تحميل الرؤى الذكية لهذا العميل المحتمل',
    step1: 'جارٍ تحليل سجل العميل المحتمل…',
    step2: 'جارٍ فحص النشاط والمهام الأخيرة…',
    step3: 'جارٍ رصد الأنماط والفرص…',
    step4: 'جارٍ تقييم مستوى التفاعل والمخاطر…',
    step5: 'جارٍ إعداد رؤى مخصّصة…',
  },
  teaser: {
    label: 'ملخص ذكي، متاح مع Pro',
    body: 'يحلّل الملخص الذكي العميل المحتمل ويقترح الخطوة التالية.',
    cta: 'عرض الملخص',
    proTitle: 'الملخص الذكي متاح مع Pro',
    proBody: 'تجديد الاشتراك يعيد الملخص الذكي.',
  },
  refresh: {
    action: 'تحديث الرؤى',
    pending: 'جارٍ التحديث…',
    rateLimited: 'حاول مرة أخرى بعد دقيقة',
    failed: 'تعذّر التحديث حاليًا',
  },
}
