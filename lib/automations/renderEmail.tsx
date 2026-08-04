import * as React from 'react'
import { render } from '@react-email/render'
import { ActionButton, FooterRows, Lines, Row, TextBlock } from './email/blocks'
import { blockText, parseBody, type ContentBlock } from './email/parseBody'
import { Shell } from './email/shell'
import { SPACE } from './email/tokens'
import { substituteVariables, type EmailVariableValues } from './variables'

export { substituteVariables, type EmailVariableValues }

/**
 * Customer-automation email rendering: closed-set variable substitution with
 * graceful fallbacks (spec §7: "שלום דנה," degrades to "שלום,"), then the shell
 * + block system in ./email. No layout decisions belong to the user; no platform
 * template is imported (spec §0).
 *
 * This file is the ORCHESTRATOR and stays thin: the shell owns the document, the
 * blocks own their typography and direction, tokens own every number. Its public
 * shape — `{subject, body, vars, unsubscribeUrl}` in, `{subject, html, text}`
 * out — is consumed by `executors/email.ts` and is additive-only.
 */

export type RenderedEmail = { subject: string; html: string; text: string }

/** Email convention: the transitional doctype, which react-email omits here. */
const DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">'

/** The optional CTA action block. Absent means nothing renders — no empty space. */
export type EmailAction = { label: string; url: string }

const ROLE_FOR = { greeting: 'greeting', paragraph: 'body', signature: 'signature' } as const

const GAP_FOR = { greeting: SPACE.betweenParagraphs, paragraph: SPACE.betweenParagraphs, signature: SPACE.beforeSignature }

function AutomationEmail(props: {
  blocks: ContentBlock[]
  action: EmailAction | null
  businessName: string
  unsubscribeUrl: string
}) {
  return (
    <Shell>
      {props.blocks.map((block, i) => (
        <Row key={i} gap={i === 0 ? undefined : GAP_FOR[block.kind]}>
          {/* Each block renders in its own role, so greeting, body and sign-off
              are no longer typographically identical. */}
          <TextBlock role={ROLE_FOR[block.kind]} text={blockText(block)}>
            <Lines lines={block.lines} emphasiseAfterFirst={block.kind === 'signature'} />
          </TextBlock>
        </Row>
      ))}

      {props.action ? (
        <Row gap={SPACE.beforeAction}>
          <ActionButton label={props.action.label} url={props.action.url} />
        </Row>
      ) : null}

      <FooterRows businessName={props.businessName} unsubscribeUrl={props.unsubscribeUrl} />
    </Shell>
  )
}

/**
 * The plain-text alternative, built from the same paragraphs as the HTML.
 *
 * Not react-email's `plainText` conversion: that collapsed the newline inside a
 * sign-off, so `"בברכה,\nסטודיו אור"` arrived as one line — the signature defect
 * visible in a text-only client and in spam-filter previews.
 */
function plainTextFrom(
  blocks: ContentBlock[],
  action: EmailAction | null,
  businessName: string,
  unsubscribeUrl: string,
): string {
  return [
    ...blocks.map(blockText),
    ...(action ? [`${action.label}: ${action.url}`] : []),
    '—'.repeat(24),
    `הודעה זו נשלחה מטעם ${businessName}.`,
    `הסרה מרשימת התפוצה: ${unsubscribeUrl}`,
  ].join('\n\n')
}

/** A CTA counts only when BOTH halves are present — it is one block, not two fields. */
function resolveAction(action: EmailAction | null | undefined, vars: EmailVariableValues): EmailAction | null {
  const label = substituteVariables(action?.label ?? '', vars).trim()
  const url = (action?.url ?? '').trim()
  if (!label || !url) return null
  return { label, url }
}

export async function renderAutomationEmail(input: {
  subject: string
  body: string
  vars: EmailVariableValues
  unsubscribeUrl: string
  /** The optional CTA action block. Omit it and the email has no button. */
  action?: EmailAction | null
}): Promise<RenderedEmail> {
  const subject = substituteVariables(input.subject, input.vars)
  const bodyText = substituteVariables(input.body, input.vars)
  const businessName = input.vars.businessName?.trim() || 'העסק'
  const blocks = parseBody(bodyText)
  const action = resolveAction(input.action, input.vars)

  const html = await render(
    <AutomationEmail
      blocks={blocks}
      action={action}
      businessName={businessName}
      unsubscribeUrl={input.unsubscribeUrl}
    />,
  )

  return {
    subject,
    html: html.startsWith('<!DOCTYPE') ? html : `${DOCTYPE}${html}`,
    text: plainTextFrom(blocks, action, businessName, input.unsubscribeUrl),
  }
}
