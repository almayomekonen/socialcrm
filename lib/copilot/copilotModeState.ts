import { DEFAULT_COPILOT_MODE_ID, isCopilotModeId, type CopilotModeId } from '@/lib/ai/copilotModes'

const STORAGE_KEY = 'social-crm:copilot:mode'

export function readPersistedMode(): CopilotModeId {
  if (typeof window === 'undefined') return DEFAULT_COPILOT_MODE_ID
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isCopilotModeId(raw) ? raw : DEFAULT_COPILOT_MODE_ID
  } catch {
    return DEFAULT_COPILOT_MODE_ID
  }
}

export function writePersistedMode(id: CopilotModeId): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Storage may be unavailable (private mode, quota). Silent — mode is a
    // UX preference, not data; in-memory state in the composer carries the
    // session.
  }
}
