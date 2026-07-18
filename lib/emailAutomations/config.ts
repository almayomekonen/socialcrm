import { baseUrl } from '@/types/vars'
import { IS_PROD } from '@/lib/email/config'
import { signUnsubscribe } from './unsubscribeToken'

// Global on/off, mirroring WELCOME_EMAIL_ENABLED. Sends only in prod with the flag on.
export function emailAutomationsEnabled(): boolean {
  return IS_PROD && process.env.EMAIL_AUTOMATIONS_ENABLED === 'true'
}

export function unsubscribeUrlFor(userId: number): string {
  const token = signUnsubscribe(userId)
  return `${baseUrl}/api/email/unsubscribe?u=${userId}&t=${encodeURIComponent(token)}`
}

export function appUrl(path: string): string {
  return `${baseUrl}${path}`
}
