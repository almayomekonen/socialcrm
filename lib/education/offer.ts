import type { EducationActionId } from './actions'
import { isEducationActionId, tourIdForAction } from './actions'
import { getTour } from './registry'

export type GuideOfferContext = {
  copilotEnabled: boolean
  whatsappConnected: boolean
  facebookConnected: boolean
  facebookNeedsReconnect: boolean
}

export type GuideEducationOffer = {
  answer: string
  route?: string
  educationAction?: EducationActionId
}

type GuideLike = {
  id: string
  answer: string
  route?: string
  educationAction?: EducationActionId
}

/**
 * Decide whether Copilot may offer Show me. Never invents an action: the guide
 * must declare an allowlisted key, the tour must exist, and entitlement/connection
 * checks can strip the action while still returning useful text.
 */
export function offerEducationForGuide(guide: GuideLike, ctx: GuideOfferContext): GuideEducationOffer {
  if (guide.id === 'guide.connectWhatsapp' && ctx.whatsappConnected) {
    return {
      answer: 'וואטסאפ כבר מחובר. שיחות נכנסות מופיעות בתיבה.',
      route: '/inbox',
    }
  }
  if (guide.id === 'guide.connectFacebook' && ctx.facebookConnected && !ctx.facebookNeedsReconnect) {
    return {
      answer: 'פייסבוק כבר מחובר. לידים חדשים מפייסבוק מופיעים במסך לידים.',
      route: '/leads',
    }
  }

  const action = guide.educationAction
  if (!action || !isEducationActionId(action)) {
    return { answer: guide.answer, route: guide.route }
  }

  const def = getTour(tourIdForAction(action))
  if (!def) return { answer: guide.answer, route: guide.route }
  if (def.requiresCopilot && !ctx.copilotEnabled) {
    return { answer: guide.answer, route: guide.route }
  }

  return { answer: guide.answer, route: guide.route, educationAction: action }
}
