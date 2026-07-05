import resend from '@/config/resend'

type UserRegisteredEvent = {
  type: 'user.registered'
  userId: number
  agencyId: number
  email: string
  firstName: string
  plan: string | null
  provider: 'google' | 'email' | null
}

type UserMetaConnectedEvent = {
  type: 'user.meta_connected'
  userId: number
  agencyId: number
  email: string
  channel: 'facebook' | 'whatsapp'
  messagingReady?: boolean
}

export type LifecycleEvent = UserRegisteredEvent | UserMetaConnectedEvent

const LOG_PREFIX = '[lifecycle-event]'

function payloadFor(event: LifecycleEvent): Record<string, unknown> {
  switch (event.type) {
    case 'user.registered':
      return {
        userId: event.userId,
        agencyId: event.agencyId,
        firstName: event.firstName,
        plan: event.plan,
        provider: event.provider,
      }
    case 'user.meta_connected':
      return {
        userId: event.userId,
        agencyId: event.agencyId,
        channel: event.channel,
        messagingReady: event.messagingReady ?? null,
      }
    default: {
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}

export async function emitLifecycleEvent(event: LifecycleEvent): Promise<void> {
  try {
    if (!process.env.RESEND?.trim()) {
      console.log(`${LOG_PREFIX}:skip`, { type: event.type, reason: 'resend_not_configured' })
      return
    }

    const payload = payloadFor(event)
    const res = await resend.events.send({ event: event.type, email: event.email, payload })

    if (res.error) {
      // Surfaced softly — a Resend-side rejection must never break the user flow.
      console.warn(`${LOG_PREFIX}:soft_error`, { type: event.type, reason: res.error.message })
      return
    }

    console.log(`${LOG_PREFIX}:emitted`, { type: event.type, email: event.email, payload })
  } catch (err) {
    console.error(`${LOG_PREFIX}:failed`, { type: event.type, reason: (err as Error)?.message ?? String(err) })
  }
}
