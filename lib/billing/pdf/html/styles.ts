// Design tokens for the invoice PDF. Calibrated for premium-SaaS calm:
// restrained slate palette, generous spacing, single source of truth so
// every component references the same scale.
//
// No accent color — the document earns trust through hierarchy and
// whitespace, not decoration.

export const PAGE = {
  width: '210mm',
  height: '297mm',
  margin: '16mm',
} as const

// Slate-derived neutrals. Strong contrast at the top (titles, totals),
// quietly recedes for secondary content. Pure black is intentionally
// avoided — it reads harsh in print.
export const COLOR = {
  ink: '#0F172A',           // titles, totals
  text: '#1E293B',           // body emphasis
  body: '#334155',           // running text
  label: '#64748B',          // section labels, secondary metadata
  mute: '#94A3B8',           // tertiary, currency code, footnotes
  ruleSoft: '#E2E8F0',       // hairline dividers
  ruleFirm: '#CBD5E1',       // stronger dividers, table header underline
  panel: '#F8FAFC',          // totals + receipt panel background
} as const

// Print-friendly type scale. Limit to ~5 distinct sizes so hierarchy stays
// readable; sizes outside the scale should be the exception, not the rule.
export const TYPE = {
  footnote: '8pt',
  label: '9pt',
  metadata: '10pt',
  body: '11pt',
  emph: '13pt',
  total: '18pt',
  number: '14pt',
  title: '24pt',
} as const

export const SP = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
  xxxl: '40px',
} as const

export const TRACKING = {
  tight: '-0.015em',
  body: '0',
  caps: '0.08em',
} as const

// Inline RTL→LTR escape applied to every numeric/Latin run inside Hebrew
// text. Pulled out so every component uses the same property bag.
export const LTR_RUN = {
  direction: 'ltr' as const,
  unicodeBidi: 'plaintext' as const,
  fontVariantNumeric: 'tabular-nums' as const,
}

export const FONT_FAMILY = "'Noto Sans Hebrew', 'Helvetica Neue', Helvetica, Arial, sans-serif"
