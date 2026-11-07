// shadcn/ui (new-york) class recipes for the /dashboard surface, mapped onto the
// app's own colour tokens (lib/css/main.css): shadcn `primary` → brand primary,
// `foreground` → ink, `muted` → neutral-bg / bg, `border` → border, `card` →
// surface. One place for the button / badge / toggle / tab / table looks so every
// block on the page has the shadcn dashboard-01 shapes in the app's colours.

const focus = 'outline-none focus-visible:ring-[3px] focus-visible:ring-primary/25 focus-visible:border-primary'

export const btn = {
  base: `inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 ${focus}`,
  default: 'bg-primary text-white shadow-xs hover:bg-primary-text',
  outline: 'border border-border bg-surface text-ink shadow-xs hover:bg-primary-tint hover:text-primary-text',
  ghost: 'text-ink hover:bg-primary-tint hover:text-primary-text',
  md: 'h-9 px-4',
  sm: 'h-8 gap-1.5 px-3',
  icon: 'size-8',
}

/** shadcn Badge, variant="outline". */
export const badgeOutline =
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-border px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ink'

/** Icon colour per tone — the meaningful colour on an outline badge (shadcn "Done" pattern). */
export const toneIcon = {
  bad: 'bg-error',
  warn: 'bg-warning',
  good: 'bg-success',
  info: 'bg-primary',
} as const

export type Tone = keyof typeof toneIcon

/** shadcn ToggleGroup variant="outline" item. */
export const toggleItem = (on: boolean) =>
  `inline-flex h-9 items-center px-3 text-sm font-medium whitespace-nowrap border border-border -ms-px first:ms-0 first:rounded-s-md last:rounded-e-md shadow-xs transition-colors ${focus} ${
    on ? 'bg-primary-tint text-primary-text' : 'bg-surface text-ink hover:bg-bg'
  }`

/** Section-card surface: the dashboard-01 `from-primary/5 to-card` gradient. */
export const sectionCard = 'bg-linear-to-t from-primary/5 to-surface'

/** Secondary text (shadcn muted-foreground). */
export const muted = 'text-gray-500'
