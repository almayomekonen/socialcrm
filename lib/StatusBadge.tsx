import type { ReactNode } from 'react'

/**
 * Unified semantic status badge (Phase 4).
 *
 * ONE chip for every technical/event status — sync, meeting outcome, billing
 * fulfillment, PDF, etc. Five roles only; colors come from the role tokens in
 * main.css (derived from the base palette, no new hues). Lead-status (a
 * pipeline) and source badges (categorical identity) deliberately do NOT use
 * this — they have their own visual systems.
 */

export type StatusRole = 'info' | 'success' | 'warning' | 'error' | 'neutral'

const ROLE_VARS: Record<StatusRole, { bg: string; text: string; border: string; dot: string }> = {
  info: { bg: 'var(--color-info-bg)', text: 'var(--color-info-text)', border: 'var(--color-info-border)', dot: 'var(--color-info-dot)' },
  success: { bg: 'var(--color-success-bg)', text: 'var(--color-success-text)', border: 'var(--color-success-border)', dot: 'var(--color-success-dot)' },
  warning: { bg: 'var(--color-warning-bg)', text: 'var(--color-warning-text)', border: 'var(--color-warning-border)', dot: 'var(--color-warning-dot)' },
  error: { bg: 'var(--color-error-bg)', text: 'var(--color-error-text)', border: 'var(--color-error-border)', dot: 'var(--color-error-dot)' },
  neutral: { bg: 'var(--color-neutral-bg)', text: 'var(--color-neutral-text)', border: 'var(--color-neutral-border)', dot: 'var(--color-neutral-dot)' },
}

type Props = {
  role: StatusRole
  label: ReactNode
  /** 'sm' = standard pill (text-xs); 'xs' = dense micro-chip (text-[10px], e.g. billing). */
  size?: 'sm' | 'xs'
  dot?: boolean
  pulse?: boolean
  className?: string
  /** Allow passthrough of data-* hooks (preserves existing inspection attributes). */
  [dataAttr: `data-${string}`]: string | undefined
}

export function StatusBadge({ role, label, size = 'sm', dot = true, pulse = false, className = '', ...dataAttrs }: Props) {
  const v = ROLE_VARS[role]
  const dense = size === 'xs'
  return (
    <span
      {...dataAttrs}
      className={`inline-flex shrink-0 items-center rounded-full border font-medium tabular-nums ${
        dense ? 'gap-1 px-1.5 py-0.5 text-[10px] leading-tight' : 'gap-1.5 px-2 py-0.5 text-xs'
      } ${className}`}
      style={{ backgroundColor: v.bg, color: v.text, borderColor: v.border }}
    >
      {dot && (
        <span
          className={`shrink-0 rounded-full ${dense ? 'size-1' : 'size-1.5'} ${pulse ? 'animate-pulse' : ''}`}
          style={{ backgroundColor: v.dot }}
        />
      )}
      {label}
    </span>
  )
}
