import * as React from 'react'
import { render } from '@react-email/render'
import { ActionButton, FooterRows, Lines, Preheader, Row, TextBlock } from './email/blocks'
import { BrandHeader, BrandRule } from './email/brand'
import { resolveAccent } from './email/contrast'
import { blockText, parseBody, type ContentBlock } from './email/parseBody'
import { Shell } from './email/shell'
import { COLOR, SPACE } from './email/tokens'
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

/**
 * What makes one customer's email look like theirs.
 *
 * `logoUrl` must be DURABLE — permanent and unauthenticated. The presigned S3
 * URLs this codebase produces for files expire, and an email is opened days or
 * years after it is sent, so a presigned URL becomes a broken image. Null is the
 * correct value until durable logo hosting exists; the wordmark is not a
 * degraded state, it is what most recipients see either way (images are blocked
 * by default in many clients).
 */
export type EmailBrand = { logoUrl?: string | null; accent?: string | null }

const ROLE_FOR = { greeting: 'greeting', paragraph: 'body', signature: 'signature' } as const

const GAP_FOR = { greeting: SPACE.betweenParagraphs, paragraph: SPACE.betweenParagraphs, signature: SPACE.beforeSignature }

/**
 * The inbox snippet, derived from content.
 *
 * Prefers the first real PARAGRAPH over the greeting: "שלום דנה," tells the
 * recipient nothing, and it is what Gmail was showing.
 */
function preheaderFrom(blocks: ContentBlock[]): string {
  const source = blocks.find((b) => b.kind === 'paragraph') ?? blocks[0]
  if (!source) return ''
  const flat = source.lines.join(' ').replace(/\s+/g, ' ').trim()
  return flat.length > 140 ? `${flat.slice(0, 139).trimEnd()}…` : flat
}

function AutomationEmail(props: {
  blocks: ContentBlock[]
  action: EmailAction | null
  businessName: string
  unsubscribeUrl: string
  brand: { logoUrl: string | null; accent: string; accentText: string; accentBorder: string }
}) {
  const preheader = preheaderFrom(props.blocks)
  return (
    <Shell preheader={preheader ? <Preheader text={preheader} /> : null}>
      <Row>
        <BrandHeader businessName={props.businessName} logoUrl={props.brand.logoUrl} />
      </Row>
      <Row gap={SPACE.betweenParagraphs}>
        <BrandRule accent={props.brand.accent} />
      </Row>

      {props.blocks.map((block, i) => (
        <Row key={i} gap={GAP_FOR[block.kind]}>
          {/* Each block renders in its own role, so greeting, body and sign-off
              are no longer typographically identical. */}
          <TextBlock role={ROLE_FOR[block.kind]} text={blockText(block)}>
            <Lines lines={block.lines} emphasiseAfterFirst={block.kind === 'signature'} />
          </TextBlock>
        </Row>
      ))}

      {props.action ? (
        <Row gap={SPACE.beforeAction}>
          <ActionButton
            label={props.action.label}
            url={props.action.url}
            accent={props.brand.accent}
            accentText={props.brand.accentText}
            accentBorder={props.brand.accentBorder}
          />
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
  /** Per-customer brand. Omitted values fall back to the platform defaults. */
  brand?: EmailBrand | null
}): Promise<RenderedEmail> {
  const subject = substituteVariables(input.subject, input.vars)
  const bodyText = substituteVariables(input.body, input.vars)
  const businessName = input.vars.businessName?.trim() || 'העסק'
  const blocks = parseBody(bodyText)
  const action = resolveAction(input.action, input.vars)
  // Label and edge are DERIVED from the accent: the customer's brand colour is
  // always honoured, and neither an unreadable label nor an invisible button is
  // reachable.
  const accent = resolveAccent(input.brand?.accent, COLOR.light.accent)

  const html = await render(
    <AutomationEmail
      blocks={blocks}
      action={action}
      businessName={businessName}
      unsubscribeUrl={input.unsubscribeUrl}
      brand={{
        logoUrl: input.brand?.logoUrl ?? null,
        accent: accent.accent,
        accentText: accent.accentText,
        accentBorder: accent.accentBorder,
      }}
    />,
  )

  return {
    subject,
    html: html.startsWith('<!DOCTYPE') ? html : `${DOCTYPE}${html}`,
    text: plainTextFrom(blocks, action, businessName, input.unsubscribeUrl),
  }
}
