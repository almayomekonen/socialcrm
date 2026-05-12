
const STORAGE_KEY = 'social-crm:copilot:open'

export function readPersistedOpen(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writePersistedOpen(open: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (open) window.sessionStorage.setItem(STORAGE_KEY, '1')
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage may be unavailable (private mode, quota). Silent — open state
    // is a UX preference, not data.
  }
}
