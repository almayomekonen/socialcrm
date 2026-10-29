import { Sparkles } from 'lucide-react'
import { dirFor, regionAttrs, type UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/** The placeholder rule mirrors the card's recommended-action rule per direction. */
const RULE = { rtl: 'ai-skel-bars border-r-2 border-gray-100 pr-3', ltr: 'ai-skel-bars border-l-2 border-gray-100 pl-3' } as const

const SKELETON_CSS = `
  /* 5 messages × 1.6s stagger = 8s cycle. Each message is visible ~1.4s with
     small in/out fades and a tiny ±2px drift. Opacity + transform only — both
     GPU-composited, never trigger layout. */
  .ai-skel-msg {
    position: absolute;
    inset-inline-start: 0;
    inset-inline-end: 0;
    opacity: 0;
    transform: translateY(2px);
    animation: ai-skel-msg-cycle 8s ease-in-out infinite;
    will-change: opacity, transform;
  }
  .ai-skel-msg-1 { animation-delay: 0s;   }
  .ai-skel-msg-2 { animation-delay: 1.6s; }
  .ai-skel-msg-3 { animation-delay: 3.2s; }
  .ai-skel-msg-4 { animation-delay: 4.8s; }
  .ai-skel-msg-5 { animation-delay: 6.4s; }

  @keyframes ai-skel-msg-cycle {
    0%   { opacity: 0; transform: translateY(2px); }
    3%   { opacity: 1; transform: translateY(0); }
    17%  { opacity: 1; transform: translateY(0); }
    20%  { opacity: 0; transform: translateY(-2px); }
    100% { opacity: 0; transform: translateY(-2px); }
  }

  /* Calm breathing — opacity-only so it composites cheaply. */
  .ai-skel-bars > * {
    animation: ai-skel-breathe 2.6s ease-in-out infinite;
  }
  @keyframes ai-skel-breathe {
    0%, 100% { opacity: 0.55; }
    50%      { opacity: 0.85; }
  }

  .ai-skel-pill {
    animation: ai-skel-pill-pulse 2.4s ease-in-out infinite;
  }
  @keyframes ai-skel-pill-pulse {
    0%, 100% { opacity: 0.7; }
    50%      { opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .ai-skel-msg, .ai-skel-bars > *, .ai-skel-pill { animation: none; }
    .ai-skel-msg-1 { opacity: 1; transform: none; }
    .ai-skel-bars > * { opacity: 0.7; }
    .ai-skel-pill { opacity: 1; }
  }
`

/** `locale`: the page's interface language (mobile passes nothing: Hebrew). */
export default function LeadIntelligenceCardSkeleton({ locale = 'he' }: { locale?: UiLocale }) {
  const t = translatorFor(locale)
  return (
    <div
      className='rounded-lg border border-gray-200 bg-white p-5 mb-8'
      style={{ minHeight: 200 }}
      aria-busy='true'
      aria-live='off'
      {...regionAttrs(locale)}
    >
      <style>{SKELETON_CSS}</style>

      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center gap-2'>
          <span className='flex items-center gap-1.5 text-xs font-semibold text-gray-500'>
            <Sparkles aria-hidden className='size-3.5 text-accent' />
            {t('leadDetail.intelligence.title')}
          </span>
          <span className='ai-skel-pill px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-500'>
            {t('leadDetail.intelligence.skeleton.analyzing')}
          </span>
        </div>
      </div>

      <span className='sr-only' role='status'>
        {t('leadDetail.intelligence.skeleton.loading')}
      </span>

      <div className='ai-skel-status relative h-5 mb-4' aria-hidden='true'>
        <span className='ai-skel-msg ai-skel-msg-1 text-sm text-gray-600'>{t('leadDetail.intelligence.skeleton.step1')}</span>
        <span className='ai-skel-msg ai-skel-msg-2 text-sm text-gray-600'>{t('leadDetail.intelligence.skeleton.step2')}</span>
        <span className='ai-skel-msg ai-skel-msg-3 text-sm text-gray-600'>{t('leadDetail.intelligence.skeleton.step3')}</span>
        <span className='ai-skel-msg ai-skel-msg-4 text-sm text-gray-600'>{t('leadDetail.intelligence.skeleton.step4')}</span>
        <span className='ai-skel-msg ai-skel-msg-5 text-sm text-gray-600'>{t('leadDetail.intelligence.skeleton.step5')}</span>
      </div>

      <div className='ai-skel-bars space-y-2 mb-5'>
        <div className='h-3 w-3/4 rounded bg-gray-100' />
        <div className='h-3 w-2/3 rounded bg-gray-100' />
      </div>

      <div className={RULE[dirFor(locale)]}>
        <div className='h-3 w-1/3 rounded bg-gray-100 mb-2' />
        <div className='h-3 w-1/2 rounded bg-gray-100' />
      </div>
    </div>
  )
}
