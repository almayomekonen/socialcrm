/**
 * Canonical positional-parameter model for WhatsApp templates. Pure.
 *
 * The agreed architecture separates two concerns that the legacy token model
 * conflated:
 *
 *  - **Arity** (how many parameters a template has) comes from the positional
 *    `{{n}}` placeholders in the template's canonical body — the exact thing Meta
 *    reviews and counts. It is NEVER derived from our chip/`variables` array, so
 *    it is correct for both in-app-created and Meta-synchronized templates.
 *  - **Meaning** (what fills each slot) comes from an explicit, ordered binding
 *    (`position → CRM source`). Bindings are always stored/declared, NEVER inferred
 *    from the `{{n}}` index.
 *
 * This is the send-side foundation. It is intentionally NOT wired into the live
 * send path in this step — `variables.ts` still drives sends until the next step
 * swaps the resolver over. Building the model in isolation keeps that swap, the
 * migration, and the mapping UI each reviewable against a proven core.
 *
 * The closed source set and the non-empty fallback discipline are shared with
 * `variables.ts` (one field-resolution implementation, RFC §10).
 */
import { TEMPLATE_VARIABLES } from './messages'
import { resolveFieldValue, resolveTemplateParams, type TemplateValueContext } from './variables'
import type { TemplateVariable } from './types'

/** The closed set of CRM fields a positional slot may bind to (RFC §10). */
export type ParameterSource = 'leadFirstName' | 'businessName'

/**
 * One positional slot's binding. `source: null` means the slot is unbound — an
 * adopted Meta template whose meaning we do not know and must not guess; it needs
 * an explicit mapping before it can be sent.
 */
export type ParameterBinding = { position: number; source: ParameterSource | null }

/** Recognized sources, derived from the single closed-set source of truth. */
const KNOWN_SOURCES = new Set<string>(TEMPLATE_VARIABLES.map((v) => v.field))

/** Matches a Meta positional placeholder and captures its 1-based index. */
const POSITIONAL = /\{\{\s*(\d+)\s*\}\}/g

/** Distinct positional indices present in a canonical body, ascending. */
export function bodyParameterIndices(bodyText: string): number[] {
  const seen = new Set<number>()
  for (const m of (bodyText ?? '').matchAll(POSITIONAL)) seen.add(Number(m[1]))
  return [...seen].sort((a, b) => a - b)
}

/**
 * The parameter ARITY Meta expects for a template — the highest positional index
 * in its canonical body (Meta numbers params `1..N`). `0` when the body has no
 * positional placeholders. A non-contiguous body (e.g. `{{1}}` + `{{3}}`) still
 * reports `3`; the missing slot then surfaces as `unmapped` at resolve time rather
 * than silently shrinking the count.
 */
export function bodyParameterCount(bodyText: string): number {
  const idx = bodyParameterIndices(bodyText)
  return idx.length ? idx[idx.length - 1] : 0
}

export type ResolveParametersResult =
  | { ok: true; params: string[] }
  | { ok: false; reason: 'unmapped'; positions: number[] }

/**
 * Resolve exactly `arity` positional parameters, in order, from explicit bindings.
 *
 * Every position `1..arity` must have a recognized, non-null binding. Any missing,
 * null, or unknown binding makes the whole result `unmapped` (listing the offending
 * positions) so the send layer can block instead of shipping a mismatched count —
 * the `#132000` class of bug becomes impossible. When every slot is bound, each
 * value is guaranteed non-empty via the shared field resolver.
 */
export function resolveParameters(
  arity: number,
  bindings: ParameterBinding[],
  ctx: TemplateValueContext,
): ResolveParametersResult {
  if (arity <= 0) return { ok: true, params: [] }

  const byPosition = new Map((bindings ?? []).map((b) => [b.position, b]))
  const unmapped: number[] = []
  const params: string[] = []

  for (let position = 1; position <= arity; position++) {
    const binding = byPosition.get(position)
    if (!binding || binding.source == null || !KNOWN_SOURCES.has(binding.source)) {
      unmapped.push(position)
      continue
    }
    params.push(resolveFieldValue(binding.source, ctx))
  }

  if (unmapped.length > 0) return { ok: false, reason: 'unmapped', positions: unmapped }
  return { ok: true, params }
}

/**
 * Unified send-time parameter resolution across both template sources.
 *
 *  - **In-app authored** (chip `variables` present): the existing token-based
 *    resolution runs unchanged — zero behavior change for templates created here.
 *  - **Meta-synchronized / positional** (no `variables`): arity comes from the
 *    body's `{{n}}` and each slot is filled from its explicit `bindings`. Unbound
 *    slots yield an `unmapped` result so the caller blocks with a clear message
 *    instead of sending a mismatched count (the `#132000` fix).
 *
 * A template with no parameters at all (either source) resolves to `[]`.
 */
export function resolveTemplateSendParameters(
  template: { bodyText: string; variables: TemplateVariable[]; bindings: ParameterBinding[] },
  ctx: TemplateValueContext,
): ResolveParametersResult {
  if (template.variables && template.variables.length > 0) {
    return { ok: true, params: resolveTemplateParams(template.bodyText, template.variables, ctx) }
  }
  const arity = bodyParameterCount(template.bodyText)
  return resolveParameters(arity, template.bindings ?? [], ctx)
}

/**
 * Human-readable body for local persistence: substitute positional `{{n}}` with
 * the resolved params (tolerates inner whitespace). Used for Meta-synced templates
 * whose stored body is positional; the chip path keeps using `renderResolvedBody`.
 */
export function renderPositionalBody(bodyText: string, params: string[]): string {
  return (bodyText ?? '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => params[Number(n) - 1] ?? `{{${n}}}`).trim()
}
