export type ActivationStatus =
  | 'waitingForActivation'
  | 'oauthPending'
  | 'selectingPage'
  | 'subscribingPage'
  | 'activationCompleted'
  | 'failed'

export type FacebookPage = { id: string; name: string; access_token: string }

export type ActivationContext = {
  pages: FacebookPage[]
  selectedPageId: string | null
  connectedPageName: string | null
  errorReason: string | null
}

export type ActivationMachine = { status: ActivationStatus; context: ActivationContext }

export type ActivationEvent =
  | { type: 'RETURN_SUCCEEDED'; pages: FacebookPage[] }
  | { type: 'RETURN_CANCELLED'; reason: string }
  | { type: 'PAGE_SELECTED'; pageId: string }
  | { type: 'SUBSCRIBE_OK'; pageName: string }
  | { type: 'SUBSCRIBE_FAILED'; reason: string }
  | { type: 'RETRY' }

const emptyContext: ActivationContext = {
  pages: [],
  selectedPageId: null,
  connectedPageName: null,
  errorReason: null,
}

export const initialMachine: ActivationMachine = { status: 'waitingForActivation', context: emptyContext }

export const oauthPendingMachine: ActivationMachine = { status: 'oauthPending', context: emptyContext }

export function reducer(m: ActivationMachine, e: ActivationEvent): ActivationMachine {
  const { status, context } = m
  switch (status) {
    case 'oauthPending':
      if (e.type === 'RETURN_SUCCEEDED') {
        if (e.pages.length === 0) return { status: 'failed', context: { ...context, errorReason: 'no_pages' } }
        if (e.pages.length === 1)
          return {
            status: 'subscribingPage',
            context: { ...context, pages: e.pages, selectedPageId: e.pages[0].id },
          }
        return { status: 'selectingPage', context: { ...context, pages: e.pages, selectedPageId: null } }
      }
      if (e.type === 'RETURN_CANCELLED') return { status: 'failed', context: { ...context, errorReason: e.reason } }
      return m

    case 'selectingPage':
      if (e.type === 'PAGE_SELECTED') return { status: 'subscribingPage', context: { ...context, selectedPageId: e.pageId } }
      return m

    case 'subscribingPage':
      if (e.type === 'SUBSCRIBE_OK')
        return { status: 'activationCompleted', context: { ...context, connectedPageName: e.pageName } }
      if (e.type === 'SUBSCRIBE_FAILED') return { status: 'failed', context: { ...context, errorReason: e.reason } }
      return m

    case 'failed':
      if (e.type === 'RETRY') return { status: 'waitingForActivation', context: emptyContext }
      return m

    case 'waitingForActivation':
    case 'activationCompleted':
    default:
      return m
  }
}

export function deriveReturnEvent(params: URLSearchParams, pages: FacebookPage[]): ActivationEvent | null {
  const a = params.get('activation')
  if (a === 'select') return { type: 'RETURN_SUCCEEDED', pages }
  if (a === 'error') return { type: 'RETURN_CANCELLED', reason: params.get('reason') ?? 'unknown' }
  return null
}

const PROGRESS: Record<ActivationStatus, number> = {
  waitingForActivation: 0.66,
  oauthPending: 0.8,
  selectingPage: 0.8,
  subscribingPage: 0.9,
  activationCompleted: 1,
  failed: 0.66,
}
export function activationProgress(status: ActivationStatus): number {
  return PROGRESS[status]
}

export type ScreenKind = 'waiting' | 'working' | 'select' | 'completed' | 'retry'
export function screenKindFor(status: ActivationStatus): ScreenKind {
  switch (status) {
    case 'waitingForActivation':
      return 'waiting'
    case 'oauthPending':
    case 'subscribingPage':
      return 'working'
    case 'selectingPage':
      return 'select'
    case 'activationCompleted':
      return 'completed'
    case 'failed':
      return 'retry'
  }
}
