import Icon, { IconNames } from '@/lib/Icon'

type Size = 'sm' | 'md' | 'lg'

const TILE: Record<Size, { tile: string; glyph: string; ring: string }> = {
  sm: { tile: 'size-7 rounded-lg', glyph: 'size-3.5', ring: 'ring-1' },
  md: { tile: 'size-12 rounded-xl', glyph: 'size-6', ring: 'ring-2' },
  lg: { tile: 'size-14 rounded-2xl', glyph: 'size-7', ring: 'ring-2' },
}

const OVERLAP: Record<Size, string> = { sm: '-ms-2.5', md: '-ms-4', lg: '-ms-5' }
const IG_GRADIENT = 'bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF]'

function BrandTile({ size, bg, icon, extra = '' }: { size: Size; bg: string; icon: IconNames; extra?: string }) {
  const s = TILE[size]
  return (
    <div className={`flex ${s.tile} items-center justify-center shadow-sm ${s.ring} ring-white ${bg} ${extra}`}>
      <Icon name={icon} type='sol' className={`${s.glyph} bg-white`} />
    </div>
  )
}

export function MetaLeadAdsBadge({ size = 'lg', className = '' }: { size?: Size; className?: string }) {
  return (
    <div className={`relative flex shrink-0 items-center ${className}`} aria-hidden='true'>
      <BrandTile size={size} bg='bg-[#1877F2]' icon='facebook-f' />
      <BrandTile size={size} bg={IG_GRADIENT} icon='instagram' extra={OVERLAP[size]} />
    </div>
  )
}

export function WhatsappBadge({ size = 'sm', className = '' }: { size?: Size; className?: string }) {
  return (
    <div className={`relative flex shrink-0 items-center ${className}`} aria-hidden='true'>
      <BrandTile size={size} bg='bg-[#25D366]' icon='whatsapp' />
    </div>
  )
}
