/** Drop in-flight sync payloads when inbox filters changed before the response landed. */
export function shouldApplySyncResponse(requestFiltersKey: string, currentFiltersKey: string): boolean {
  return requestFiltersKey === currentFiltersKey
}
