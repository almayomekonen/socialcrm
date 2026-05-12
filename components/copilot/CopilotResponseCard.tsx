'use client'

import { FollowupBody } from './bodies/FollowupBody'
import { NextStepBody } from './bodies/NextStepBody'
import { AnswerBody } from './bodies/AnswerBody'
import { ErrorBody } from './bodies/ErrorBody'
import type { CopilotActionId, CopilotResponseErrorReason, CopilotResponsePayload } from '@/lib/copilot/copilotResponse'

type Props =
  | { state: 'success'; payload: CopilotResponsePayload; staticRender?: boolean }
  | { state: 'error'; actionId: CopilotActionId; reason: CopilotResponseErrorReason; onRetry: () => void }

export default function CopilotResponseCard(props: Props) {
  if (props.state === 'error') {
    return <ErrorBody reason={props.reason} onRetry={props.onRetry} />
  }
  const staticRender = props.staticRender === true
  if (props.payload.actionId === 'draft-followup-message') {
    return <FollowupBody data={props.payload.data} staticRender={staticRender} />
  }
  if (props.payload.actionId === 'next-best-step') {
    return <NextStepBody data={props.payload.data} staticRender={staticRender} />
  }
  return <AnswerBody data={props.payload.data} staticRender={staticRender} />
}
