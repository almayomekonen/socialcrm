export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return ''
  return String(email).trim().toLowerCase()
}
