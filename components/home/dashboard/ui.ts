// shadcn/ui (new-york, neutral, light) class recipes for the /dashboard surface.
// One place for the button / badge / toggle / table looks so every block on the
// page uses the same values as the shadcn dashboard-01 example. The app's own
// tokens (primary purple, ink navy) are deliberately not used here: the owner
// asked for the shadcn neutral look on this page.

const focus = 'outline-none focus-visible:ring-[3px] focus-visible:ring-neutral-950/15 focus-visible:border-neutral-400'

export const btn = {
  base: `inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${focus}`,
  default: 'bg-neutral-900 text-white shadow-xs hover:bg-neutral-900/90',
  outline: 'border border-neutral-200 bg-white text-neutral-950 shadow-xs hover:bg-neutral-100',
  ghost: 'text-neutral-950 hover:bg-neutral-100',
  md: 'h-9 px-4',
  sm: 'h-8 gap-1.5 px-3',
  icon: 'size-8',
}

/** shadcn Badge, variant="outline". */
export const badgeOutline =
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-neutral-200 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-neutral-950'

/** Icon colour per tone — the only colour on a neutral badge (shadcn "Done" pattern). */
export const toneIcon = {
  bad: 'bg-red-500',
  warn: 'bg-amber-500',
  good: 'bg-green-500',
  info: 'bg-neutral-500',
} as const

export type Tone = keyof typeof toneIcon

/** shadcn ToggleGroup variant="outline" item. */
export const toggleItem = (on: boolean) =>
  `inline-flex h-9 items-center px-3 text-sm font-medium whitespace-nowrap border border-neutral-200 -ms-px first:ms-0 first:rounded-s-md last:rounded-e-md shadow-xs transition-colors ${focus} ${
    on ? 'bg-neutral-100 text-neutral-950' : 'bg-white text-neutral-950 hover:bg-neutral-100'
  }`

/** Section-card surface: the dashboard-01 gradient on white. */
export const sectionCard = 'bg-linear-to-t from-neutral-900/[0.04] to-white'
