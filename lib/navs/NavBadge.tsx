/**
 * The one unread badge in the app.
 *
 * Moved out of Nav.tsx unchanged (P2.3) so the notification bell can use the
 * SAME implementation rather than a second one that would drift — most visibly
 * on the 99+ cap, where two copies eventually disagree about the boundary.
 * The markup is byte-identical to what Nav rendered before the move.
 *
 * `aria-hidden` is deliberate: the badge is a visual echo of a count that the
 * control it sits on must already state in its accessible name. Exposing it
 * twice makes a screen reader say the number twice.
 */
export default function NavBadge({ count }: { count: number }) {
  return (
    <span
      aria-hidden
      className='absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white'
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
