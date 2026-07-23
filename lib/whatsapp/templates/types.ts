/**
 * Shared domain types for WhatsApp ready-made messages (templates).
 *
 * These are the app-facing shapes. Meta's vocabulary (WABA, components, BODY,
 * category enum) is confined to the service/repo internals and never leaks into
 * the `Template` shape that reaches the UI.
 */

/** Meta approval status, projected to our closed local enum (statusCopy maps it). */
export type TemplateStatus = 'pending' | 'approved' | 'rejected' | 'paused' | 'disabled'

/** The user-facing "purpose" question (RFC §8) — maps to a Meta category on create. */
export type TemplatePurpose = 'UTILITY' | 'MARKETING'

/** Meta category (internal). AUTHENTICATION is reserved for a future sprint (RFC §11). */
export type TemplateCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION'

/** Rejection buckets (statusCopy maps Meta reasons into these). Stored, never raw. */
export type RejectionCategory = 'invalid_format' | 'policy' | 'content_mismatch' | 'generic'

/** A friendly variable: the chip token the owner sees + its preview/sample value. */
export type TemplateVariable = { token: string; sample: string }

/** A Meta template component (BODY today; HEADER/BUTTONS are the forward-compat seam). */
export type MetaComponent = {
  type: 'BODY' | 'HEADER' | 'FOOTER' | 'BUTTONS'
  text?: string
  example?: { body_text?: string[][] }
}

/** The create form's payload (used by validate now; by the create action in Sprint 3). */
export type TemplateInput = {
  displayTitle: string
  bodyText: string
  purpose: TemplatePurpose
  variables: TemplateVariable[]
}

/**
 * UI-shaped template — Meta terms stripped. `failureText` is resolved server-side
 * (never a raw Meta reason) and is non-null only when `status === 'rejected'`.
 */
export type Template = {
  id: number
  displayTitle: string
  status: TemplateStatus
  bodyText: string
  variables: TemplateVariable[]
  failureText: string | null
  archived: boolean
  createdAt: string
}
