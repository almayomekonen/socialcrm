const CHANNELS = [
  { name: 'וואטסאפ', icon: 'whatsapp', bg: '#25D366' },
  { name: 'פייסבוק', icon: 'facebook', bg: '#1877F2' },
  {
    name: 'אינסטגרם',
    icon: 'instagram',
    bg: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
  },
] as const

/**
 * The "works with" channel row above the headline: each platform glyph in white
 * on its brand-colored chip. Icons come from the same /media/social-icons SVGs
 * the hero scene uses (applied as a mask), so they stay crisp and tiny.
 */
export function ChannelBadges() {
  return (
    <div className='mb-6 flex items-center gap-2.5'>
      {CHANNELS.map((c) => (
        <span
          key={c.icon}
          title={c.name}
          className='flex size-9 items-center justify-center rounded-full shadow-sm ring-1 ring-black/5 transition-transform duration-200 hover:-translate-y-0.5 hover:scale-105'
          style={{ background: c.bg }}
        >
          <span className='sr-only'>{c.name}</span>
          <span
            aria-hidden='true'
            className='size-[18px]'
            style={{
              backgroundColor: '#ffffff',
              maskImage: `url(/media/social-icons/${c.icon}.svg)`,
              WebkitMaskImage: `url(/media/social-icons/${c.icon}.svg)`,
              maskSize: 'contain',
              WebkitMaskSize: 'contain',
              maskPosition: 'center',
              WebkitMaskPosition: 'center',
              maskRepeat: 'no-repeat',
              WebkitMaskRepeat: 'no-repeat',
            }}
          />
        </span>
      ))}
    </div>
  )
}
