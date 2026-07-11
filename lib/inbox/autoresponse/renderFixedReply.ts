/**
 * Tiny fixed-reply variable renderer for Auto Response.
 * Phase 1: {{firstName}} only. Unknown {{tokens}} left unchanged.
 */
export type FixedReplyVars = {
  firstName?: string | null
  customerName?: string | null
}

export function resolveFirstName(vars: FixedReplyVars): string {
  const fromLead = (vars.firstName ?? '').trim()
  if (fromLead) return fromLead
  const fromCustomer = (vars.customerName ?? '').trim()
  if (!fromCustomer) return ''
  return fromCustomer.split(/\s+/)[0] ?? ''
}

export function renderFixedReply(template: string, vars: FixedReplyVars): string {
  const firstName = resolveFirstName(vars)
  return template.replace(/\{\{\s*firstName\s*\}\}/g, firstName)
}
