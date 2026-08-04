import * as React from 'react'
import { render } from '@react-email/render'
import { FooterRows, Row, TextBlock } from './email/blocks'
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

function AutomationEmail(props: { paragraphs: string[]; businessName: string; unsubscribeUrl: string }) {
  return (
    <Shell>
      {props.paragraphs.map((paragraph, i) => (
        <Row key={i} gap={i === 0 ? undefined : SPACE.betweenParagraphs}>
          {/* The opening line gets its own role so the email has somewhere for
              the eye to land. Before this, greeting, body and sign-off were
              typographically identical. */}
          <TextBlock role={i === 0 ? 'greeting' : 'body'} text={paragraph}>
            {paragraph}
          </TextBlock>
        </Row>
      ))}
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
function plainTextFrom(paragraphs: string[], businessName: string, unsubscribeUrl: string): string {
  return [
    ...paragraphs,
    '—'.repeat(24),
    `הודעה זו נשלחה מטעם ${businessName}.`,
    `הסרה מרשימת התפוצה: ${unsubscribeUrl}`,
  ].join('\n\n')
}

export async function renderAutomationEmail(input: {
  subject: string
  body: string
  vars: EmailVariableValues
  unsubscribeUrl: string
}): Promise<RenderedEmail> {
  const subject = substituteVariables(input.subject, input.vars)
  const bodyText = substituteVariables(input.body, input.vars)
  const businessName = input.vars.businessName?.trim() || 'העסק'
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  const html = await render(
    <AutomationEmail paragraphs={paragraphs} businessName={businessName} unsubscribeUrl={input.unsubscribeUrl} />,
  )

  return {
    subject,
    html: html.startsWith('<!DOCTYPE') ? html : `${DOCTYPE}${html}`,
    text: plainTextFrom(paragraphs, businessName, input.unsubscribeUrl),
  }
}
