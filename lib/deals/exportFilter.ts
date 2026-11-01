/**
 * The ONLY input the deals export accepts from the client: the deals page's
 * active filter — the same `?filter=` JSON the page itself renders with
 * (`resolveActiveFilter('deals', …)`). The server rebuilds the query from it
 * through the page's own path (`getPermsAndFilter` → `dealsQuery`), so agency,
 * role and rep permissions come from the session, never from this value.
 *
 * No SQL, bindings, table or column names, and no signed token: a string that is
 * not a JSON object (an old export token included) is refused.
 */

export const MAX_EXPORT_FILTER_LENGTH = 8_000

export type ExportFilterResult = { ok: true; filter: string | undefined } | { ok: false }

export function parseExportFilter(input: unknown): ExportFilterResult {
  // No filter: the section's normal defaults, exactly as the page with none.
  if (input === null || input === undefined || input === '') return { ok: true, filter: undefined }
  if (typeof input !== 'string' || input.length > MAX_EXPORT_FILTER_LENGTH) return { ok: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    return { ok: false }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false }
  return { ok: true, filter: input }
}
