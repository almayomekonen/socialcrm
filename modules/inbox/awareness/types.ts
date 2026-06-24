/**
 * Awareness feed item — the shared shape behind the WhatsApp toast and (later)
 * the notification center / bell. Phase 1 emits only `whatsapp_message`; the
 * other variants and `priority` are reserved so new item types slot in without
 * a redesign.
 */
export type AwarenessPriority = 'high' | 'medium' | 'low'

export type AwarenessItem = {
  type: 'whatsapp_message' // future: 'new_lead' | 'task_due' | 'ai_alert'
  conversationId: number
  contactName: string
  at: string // ISO 8601
  priority?: AwarenessPriority // optional, unused in Phase 1
}
