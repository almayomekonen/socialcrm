/**
 * Post-handoff inbound policy. After a real escalation the qualifier does not
 * resume sales. Status follow-ups get one short confirmation. Passive thanks
 * stay silent. Other inbounds may use the gated GPT concierge.
 */
import { detectHumanRequest, isCasualAcknowledgement } from './salesIntent'

export type PostHandoffInboundAction = 'confirm' | 'silent' | 'concierge'

const STATUS_FOLLOW_UP: RegExp[] = [
  /אתה מעביר/,
  /העברת/,
  /מעביר אותי/,
  /עברת אותי/,
  /מישהו יחזור/,
  /מישהו חוזר/,
  /יחזור אלי/,
  /מה קורה עכשיו/,
  /מחכים לנציג/,
  /מחכה לנציג/,
  /אז מחכים/,
  /are you (transferring|handing)/i,
  /did you (transfer|hand)/i,
  /anyone (coming|calling|getting back)/i,
  /waiting for (a )?(rep|human|agent|someone)/i,
]

export function isPostHandoffStatusFollowUp(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  return STATUS_FOLLOW_UP.some((re) => re.test(t))
}

export function decidePostHandoffInbound(text: string): PostHandoffInboundAction {
  const t = (text ?? '').trim()
  if (!t) return 'silent'
  if (isPostHandoffStatusFollowUp(t) || detectHumanRequest(t)) return 'confirm'
  if (isCasualAcknowledgement(t)) return 'silent'
  return 'concierge'
}

export function postHandoffStatusMessage(lang: 'he' | 'en'): string {
  return lang === 'en'
    ? 'Yes, your request is with the team and waiting for a rep.'
    : 'כן, הפנייה אצל הצוות וממתינה לטיפול נציג.'
}
