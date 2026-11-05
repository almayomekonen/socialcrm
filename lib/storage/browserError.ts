/**
 * The <Code> from an R2 error body. An HTTP 403 alone cannot tell a bad signature from
 * a disabled account, and only this code can; it is the one part of the body reported.
 */
export function storageErrorCode(body: unknown): string | null {
  if (typeof body !== 'string') return null
  return /<Code>([A-Za-z0-9_.-]{1,60})<\/Code>/.exec(body)?.[1] ?? null
}
