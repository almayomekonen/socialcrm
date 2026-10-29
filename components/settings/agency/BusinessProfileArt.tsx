/**
 * NOTE: this file is ~300 lines and intentionally so (architecture-rules §6).
 * It is one linear SVG drawing; splitting it would pass coordinates between
 * micro-components for no readability gain. Its labels come from
 * `settings.account.art` (Phase E4) in the page's language.
 */
import Portrait from '@/components/settings/art/Portrait'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The official WhatsApp mark, the same path this repo already ships at
 * `public/media/social-icons/whatsapp.svg` and the same one the auto-reply
 * page puts beside its heading. Drawn on a 24×24 grid, so it gets scaled into
 * place. Using the real glyph rather than a chat bubble is the point: it has
 * to be recognised before it is read.
 */
const WHATSAPP_MARK =
  'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z'

export default function BusinessProfileArt({ photoUrl, locale = 'he' }: { photoUrl?: string | null; locale?: UiLocale }) {
  const t = translatorFor(locale)
  // Parsing rather than trusting: this ends up inside a CSS `url()`, and
  // `URL.toString()` percent-encodes the quote that would otherwise let a
  // stored value break out of it.
  const photo = (() => {
    if (!photoUrl) return null
    try {
      const parsed = new URL(photoUrl)
      return parsed.protocol === 'https:' ? parsed.toString() : null
    } catch {
      return null
    }
  })()

  return (
    <svg
      viewBox='0 0 940 280'
      fill='none'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      role='img'
      aria-label={t('settings.account.art.label')}
      /* Capped at its drawn size, so on a wide settings column this is exactly
         940×280 and on a narrow one the scene scales down instead of being
         cropped by the frame's overflow. */
      className='bpa h-auto w-full max-w-235'
    >
      <defs>
        <linearGradient id='b5c' x1='1' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#ffffff' />
          <stop offset='1' stopColor='#f7f8fb' />
        </linearGradient>
        <linearGradient id='b5b' x1='1' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#e3ecdf' />
          <stop offset='1' stopColor='#cbd9c8' />
        </linearGradient>
        {/* Envelope, payment card and invoice bodies — each a light-to-dark of
            the flat colour the icon used before, lit from the top right. */}
        <linearGradient id='b5m' x1='1' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#dceafb' />
          <stop offset='1' stopColor='#bcd4f2' />
        </linearGradient>
        <linearGradient id='b5p' x1='1' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#7c8ba1' />
          <stop offset='1' stopColor='#59677b' />
        </linearGradient>
        <linearGradient id='b5i' x1='1' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#ffffff' />
          <stop offset='1' stopColor='#eceefb' />
        </linearGradient>
        {/* The sheen laid over the avatar: the same top-right key light every
            other gradient here is built on, so a real photograph picks up the
            scene's lighting instead of staying flat. */}
        <linearGradient id='b5sh' x1='1' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#ffffff' stopOpacity='.22' />
          <stop offset='.45' stopColor='#ffffff' stopOpacity='0' />
          <stop offset='1' stopColor='#0a2540' stopOpacity='.07' />
        </linearGradient>
        <filter id='b5e2' x='-60%' y='-60%' width='220%' height='220%'>
          <feDropShadow dx='0' dy='6' stdDeviation='8' floodColor='#0a2540' floodOpacity='0.10' />
        </filter>
        <filter id='b5e1' x='-60%' y='-60%' width='220%' height='220%'>
          <feDropShadow dx='0' dy='3' stdDeviation='5' floodColor='#0a2540' floodOpacity='0.07' />
        </filter>
      </defs>

      {/* Six runs out of the centre, and the dot each one lands on. The
          `bpa-run-*` class is the entrance order; the motes further down carry
          the matching one so a run and its traffic arrive together. */}
      <path className='bpa-run bpa-run-1' d='M470 68c0-24 44-30 84-30h56' stroke='#cdd3dc' strokeDasharray='3 5' />
      <path className='bpa-run bpa-run-2' d='M580 140h72' stroke='#cdd3dc' strokeDasharray='3 5' />
      <path className='bpa-run bpa-run-3' d='M470 212c0 24 44 30 84 30h56' stroke='#cdd3dc' strokeDasharray='3 5' />
      <path className='bpa-run bpa-run-4' d='M470 68c0-24-44-30-84-30h-56' stroke='#cdd3dc' strokeDasharray='3 5' />
      <path className='bpa-run bpa-run-5' d='M360 140h-72' stroke='#cdd3dc' strokeDasharray='3 5' />
      <path className='bpa-run bpa-run-6' d='M470 212c0 24-44 30-84 30h-56' stroke='#cdd3dc' strokeDasharray='3 5' />
      <circle className='bpa-dot' cx='610' cy='38' r='3.5' fill='#d3d8e0' />
      <circle className='bpa-dot' cx='652' cy='140' r='3.5' fill='#d3d8e0' />
      <circle className='bpa-dot' cx='610' cy='242' r='3.5' fill='#d3d8e0' />
      <circle className='bpa-dot' cx='330' cy='38' r='3.5' fill='#d3d8e0' />
      <circle className='bpa-dot' cx='288' cy='140' r='3.5' fill='#d3d8e0' />
      <circle className='bpa-dot' cx='330' cy='242' r='3.5' fill='#d3d8e0' />

      {/* The halo that marks the centre as the origin of everything else. */}
      <circle cx='470' cy='140' r='138' fill='#5e6ad2' opacity='.03' />
      <circle cx='470' cy='140' r='118' fill='#5e6ad2' opacity='.05' />
      <circle cx='470' cy='140' r='118' stroke='#dcdff4' opacity='.7' />

      {/* Motes travelling each run. Alpha lives on `fillOpacity` so the
          entrance can animate `opacity` without flattening them to solid. */}
      <circle className='bpa-run bpa-run-1' cx='502' cy='45' r='2.4' fill='#5e6ad2' fillOpacity='0.45' />
      <circle className='bpa-run bpa-run-1' cx='540' cy='38' r='1.9' fill='#5e6ad2' fillOpacity='0.3' />
      <circle className='bpa-run bpa-run-1' cx='576' cy='38' r='1.4' fill='#5e6ad2' fillOpacity='0.18' />
      <circle className='bpa-run bpa-run-2' cx='600' cy='140' r='2.4' fill='#5e6ad2' fillOpacity='0.45' />
      <circle className='bpa-run bpa-run-2' cx='620' cy='140' r='1.9' fill='#5e6ad2' fillOpacity='0.3' />
      <circle className='bpa-run bpa-run-2' cx='638' cy='140' r='1.4' fill='#5e6ad2' fillOpacity='0.18' />
      <circle className='bpa-run bpa-run-3' cx='502' cy='235' r='2.4' fill='#5e6ad2' fillOpacity='0.45' />
      <circle className='bpa-run bpa-run-3' cx='540' cy='242' r='1.9' fill='#5e6ad2' fillOpacity='0.3' />
      <circle className='bpa-run bpa-run-3' cx='576' cy='242' r='1.4' fill='#5e6ad2' fillOpacity='0.18' />
      <circle className='bpa-run bpa-run-4' cx='438' cy='45' r='2.4' fill='#5e6ad2' fillOpacity='0.45' />
      <circle className='bpa-run bpa-run-4' cx='400' cy='38' r='1.9' fill='#5e6ad2' fillOpacity='0.3' />
      <circle className='bpa-run bpa-run-4' cx='364' cy='38' r='1.4' fill='#5e6ad2' fillOpacity='0.18' />
      <circle className='bpa-run bpa-run-5' cx='340' cy='140' r='2.4' fill='#5e6ad2' fillOpacity='0.45' />
      <circle className='bpa-run bpa-run-5' cx='320' cy='140' r='1.9' fill='#5e6ad2' fillOpacity='0.3' />
      <circle className='bpa-run bpa-run-5' cx='302' cy='140' r='1.4' fill='#5e6ad2' fillOpacity='0.18' />
      <circle className='bpa-run bpa-run-6' cx='438' cy='235' r='2.4' fill='#5e6ad2' fillOpacity='0.45' />
      <circle className='bpa-run bpa-run-6' cx='400' cy='242' r='1.9' fill='#5e6ad2' fillOpacity='0.3' />
      <circle className='bpa-run bpa-run-6' cx='364' cy='242' r='1.4' fill='#5e6ad2' fillOpacity='0.18' />

      {/* The business profile itself: avatar, name, verified, then the details. */}
      <g filter='url(#b5e2)'>
        <rect x='360' y='52' width='220' height='176' rx='18' fill='url(#b5c)' stroke='#e6e9ef' />
      </g>

      {/*
        The signed-in person, in the 44px square the placeholder mark used to
        occupy. The illustration is painted first and the photo over it, so an
        expired or rate-limited Google URL leaves the drawn avatar showing.
        It is a CSS background rather than an SVG `<image>` on purpose — a
        broken `<image>` paints the browser's own broken-photo glyph over the
        fallback, where a broken background simply does not paint.

        Mount (r=24) → photo (r=22) → sheen → hairline: the 2px white ring
        and the satellites' own elevation (b5e1) are what settle a real
        photograph into the scene instead of leaving it pasted on.
      */}
      <g className='bpa-avatar'>
        <g filter='url(#b5e1)'>
          <circle cx='538' cy='94' r='24' fill='#fff' />
        </g>
        <Portrait cx={538} cy={94} r={22} uid='b5' />
        {photo && (
          <foreignObject x='516' y='72' width='44' height='44'>
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                backgroundImage: `url("${photo}")`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
          </foreignObject>
        )}
        <circle cx='538' cy='94' r='22' fill='url(#b5sh)' />
        <circle cx='538' cy='94' r='22' fill='none' stroke='rgba(16,24,64,.10)' strokeWidth='0.8' />
      </g>

      <rect x='392' y='78' width='108' height='9' rx='4.5' fill='#e2e6ec' />
      <rect x='428' y='96' width='72' height='7' rx='3.5' fill='#eef0f4' />
      <circle cx='382' cy='74' r='7.5' fill='#25D366' opacity='.14' />
      <circle cx='382' cy='74' r='3.2' fill='#25D366' />
      <rect x='452' y='112' width='48' height='12' rx='6' fill='#eff9f3' />
      <path d='M462 118l2.4 2.4 4.4-4.8' stroke='#1f9d57' />
      <rect x='472' y='116' width='20' height='4' rx='2' fill='#8fd6b0' />
      <rect x='380' y='132' width='180' height='1' fill='#f1f3f7' />

      {/* Phone: a handset with an actual earpiece and mouthpiece. */}
      <circle cx='548' cy='152' r='9' fill='#f1f3f7' />
      <path
        d='M544.6 147.4c-.7.6-1 1.6-.8 2.5.5 2.3 1.7 4.2 3.6 5.6.8.6 1.8.6 2.6.1l.9-.6-1.8-2.3-1.2.5-2-2 .5-1.2-2.3-1.8z'
        fill='#8d99ad'
      />
      <path d='M549.8 148.4a3.4 3.4 0 0 1 2.6 2.6' stroke='#b6bfcd' strokeWidth='1.2' />
      <rect x='392' y='148' width='140' height='8' rx='4' fill='#eef0f4' />

      {/* Mail: a body with the back flap folded open over it. */}
      <circle cx='548' cy='180' r='9' fill='#f1f3f7' />
      <rect x='543' y='176' width='10' height='8' rx='1.6' fill='#dfe4ea' />
      <path d='M543 177.2l4.4 3.2a1 1 0 0 0 1.2 0l4.4-3.2' stroke='#8d99ad' strokeWidth='1.2' />
      <rect x='404' y='176' width='128' height='8' rx='4' fill='#eef0f4' />

      {/* Pin: solid teardrop with a punched-out centre, not an outline. */}
      <circle cx='548' cy='208' r='9' fill='#f1f3f7' />
      <path d='M548 202.8a4.6 4.6 0 0 0-4.6 4.6c0 3.3 4.6 6.6 4.6 6.6s4.6-3.3 4.6-6.6a4.6 4.6 0 0 0-4.6-4.6z' fill='#8d99ad' />
      <circle cx='548' cy='207.3' r='1.7' fill='#f1f3f7' />
      <rect x='416' y='204' width='116' height='8' rx='4' fill='#eef0f4' />

      {/* וואטסאפ */}
      <g filter='url(#b5e1)'>
        <rect x='616' y='16' width='176' height='46' rx='14' fill='#fff' stroke='#e6e9ef' />
      </g>
      <circle cx='768' cy='39' r='14' fill='#eff9f3' />
      <g transform='translate(759 30) scale(.75)'>
        <path d={WHATSAPP_MARK} fill='#25D366' />
      </g>
      <circle cx='626' cy='28' r='2.6' fill='#5e6ad2' opacity='.35' />
      <text x='744' y='35' textAnchor='start' fontSize='13' fontWeight='600' fill='#3f4d5e' direction='rtl'>
        {t('settings.account.art.whatsapp')}
      </text>
      <text x='744' y='51' textAnchor='start' fontSize='12' fill='#8b98a8' direction='rtl'>
        {t('settings.account.art.whatsappHint')}
      </text>

      {/* כרטיס לקוח — the same drawn person as the profile, so the two read as
          the same illustration system rather than two unrelated marks. */}
      <g filter='url(#b5e1)'>
        <rect x='658' y='118' width='176' height='46' rx='14' fill='#fff' stroke='#e6e9ef' />
      </g>
      <Portrait cx={810} cy={141} r={14} uid='b5' warm />
      <circle cx='668' cy='130' r='2.6' fill='#5e6ad2' opacity='.35' />
      <text x='786' y='137' textAnchor='start' fontSize='13' fontWeight='600' fill='#3f4d5e' direction='rtl'>
        {t('settings.account.art.card')}
      </text>
      <text x='786' y='153' textAnchor='start' fontSize='12' fill='#8b98a8' direction='rtl'>
        {t('settings.account.art.cardHint')}
      </text>

      {/* חשבוניות — a document with a turned corner, a header and a total row. */}
      <g filter='url(#b5e1)'>
        <rect x='616' y='220' width='176' height='46' rx='14' fill='#fff' stroke='#e6e9ef' />
      </g>
      <circle cx='768' cy='243' r='14' fill='#f3f4fc' />
      <path
        d='M763 236.2a1.6 1.6 0 0 1 1.6-1.6h5.1l3.3 3.3v11.9a1.6 1.6 0 0 1-1.6 1.6h-6.8a1.6 1.6 0 0 1-1.6-1.6z'
        fill='url(#b5i)'
        stroke='#8b93e0'
        strokeWidth='1.1'
      />
      <path d='M769.7 234.6v3.3h3.3' stroke='#8b93e0' strokeWidth='1.1' />
      <path d='M765.4 241.4h4.2M765.4 244h5.3' stroke='#a8aee8' strokeWidth='1.1' />
      <rect x='765.4' y='246.4' width='4.2' height='2.2' rx='1.1' fill='#5e6ad2' />
      <circle cx='626' cy='232' r='2.6' fill='#5e6ad2' opacity='.35' />
      <text x='744' y='239' textAnchor='start' fontSize='13' fontWeight='600' fill='#3f4d5e' direction='rtl'>
        {t('settings.account.art.invoices')}
      </text>
      <text x='744' y='255' textAnchor='start' fontSize='12' fill='#8b98a8' direction='rtl'>
        {t('settings.account.art.invoicesHint')}
      </text>

      {/* מייל יוצא — a letter lifting out of the envelope, since this one is outgoing. */}
      <g filter='url(#b5e1)'>
        <rect x='148' y='16' width='176' height='46' rx='14' fill='#fff' stroke='#e6e9ef' />
      </g>
      <circle cx='300' cy='39' r='14' fill='#f2f5fc' />
      <rect x='296' y='31' width='9' height='7' rx='1.2' fill='#fff' stroke='#9dbbe4' strokeWidth='1' />
      <path d='M298 33.4h5M298 35.4h3.4' stroke='#9dbbe4' strokeWidth='1' />
      <path
        d='M293 36.6a1.6 1.6 0 0 1 1.6-1.6h10.8a1.6 1.6 0 0 1 1.6 1.6v7.2a1.6 1.6 0 0 1-1.6 1.6h-10.8a1.6 1.6 0 0 1-1.6-1.6z'
        fill='url(#b5m)'
      />
      <path d='M293 36.9l5.9 4.3a1.9 1.9 0 0 0 2.2 0l5.9-4.3' stroke='#3b6fbf' strokeWidth='1.2' />
      <circle cx='158' cy='28' r='2.6' fill='#5e6ad2' opacity='.35' />
      <text x='276' y='35' textAnchor='start' fontSize='13' fontWeight='600' fill='#3f4d5e' direction='rtl'>
        {t('settings.account.art.email')}
      </text>
      <text x='276' y='51' textAnchor='start' fontSize='12' fill='#8b98a8' direction='rtl'>
        {t('settings.account.art.emailHint')}
      </text>

      {/* תשלומים — a card with a magnetic stripe and a chip. */}
      <g filter='url(#b5e1)'>
        <rect x='106' y='118' width='176' height='46' rx='14' fill='#fff' stroke='#e6e9ef' />
      </g>
      <circle cx='258' cy='141' r='14' fill='#f1f3f7' />
      <rect x='250' y='134.5' width='16' height='11.5' rx='2.2' fill='url(#b5p)' />
      <rect x='250' y='137.4' width='16' height='2.6' fill='#41505f' />
      <rect x='252' y='142' width='3.6' height='2.6' rx='.7' fill='#d7dde5' opacity='.85' />
      <rect x='257.4' y='143' width='6.6' height='1.4' rx='.7' fill='#fff' opacity='.5' />
      <circle cx='116' cy='130' r='2.6' fill='#5e6ad2' opacity='.35' />
      <text x='234' y='137' textAnchor='start' fontSize='13' fontWeight='600' fill='#3f4d5e' direction='rtl'>
        {t('settings.account.art.payments')}
      </text>
      <text x='234' y='153' textAnchor='start' fontSize='12' fill='#8b98a8' direction='rtl'>
        {t('settings.account.art.paymentsHint')}
      </text>

      {/* מיתוג — the logo tile carrying the same mark the profile card used to
          show, which is the point of the row: the logo goes out on everything. */}
      <g filter='url(#b5e1)'>
        <rect x='148' y='220' width='176' height='46' rx='14' fill='#fff' stroke='#e6e9ef' />
      </g>
      <circle cx='300' cy='243' r='14' fill='#f7f2ea' />
      <rect x='292.8' y='235.8' width='14.4' height='14.4' rx='3.8' fill='url(#b5b)' stroke='#b9c9b6' strokeWidth='.9' />
      <path d='M296.6 247.2l3.4-7.2 3.4 7.2' stroke='#6f8a6b' strokeWidth='1.3' />
      <path d='M298.2 244.4h3.6' stroke='#6f8a6b' strokeWidth='1.3' />
      <circle cx='158' cy='232' r='2.6' fill='#5e6ad2' opacity='.35' />
      <text x='276' y='239' textAnchor='start' fontSize='13' fontWeight='600' fill='#3f4d5e' direction='rtl'>
        {t('settings.account.art.branding')}
      </text>
      <text x='276' y='255' textAnchor='start' fontSize='12' fill='#8b98a8' direction='rtl'>
        {t('settings.account.art.brandingHint')}
      </text>
    </svg>
  )
}
