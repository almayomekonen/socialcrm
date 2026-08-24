import { cn } from '@/lib/utils'

/**
 * The frame every product visual sits in — one device, used everywhere, so the
 * software reads as the same product on every page.
 *
 * It frames CODE-RENDERED SocialCRM UI, never a raster screenshot. Lumen's own
 * hero mockup is a desktop capture scaled down; at 390px and 320px its sidebar
 * labels and column headers render sub-6px and it functions as decoration.
 * Measured on the live demo. Code-rendered surfaces stay sharp at any DPI,
 * correct in RTL, and can drop columns on small screens instead of shrinking.
 */
export function ProductFrame({
  className,
  children,
  /** Drops the outer inset frame — for visuals that sit flush in a grid cell. */
  bare,
}: {
  className?: string
  children: React.ReactNode
  bare?: boolean
}) {
  if (bare) return <div className={cn('mkt-frame-inner', className)}>{children}</div>

  return (
    <div className={cn('mkt-frame', className)}>
      <div className='mkt-frame-inner'>{children}</div>
    </div>
  )
}
