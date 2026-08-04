import * as React from 'react'
import { COLOR, FONT_STACK, SPACE, TYPE, alignFor, resolveDirection, type Direction } from './tokens'

/**
 * The block vocabulary for customer-automation email.
 *
 * Two rules run through all of it:
 *
 * 1. Vertical rhythm comes from `padding-top` on a table cell, never from
 *    margins on the text element. Adjacent margins collapse in browsers and do
 *    not in Outlook, so a both-direction margin gives one email two rhythms.
 *    Every text element therefore declares `margin:0` and owns no spacing.
 * 2. Direction is declared ON the text element, resolved from its own content.
 *    The pre-Phase-1 renderer put `dir="rtl"` only on `<html>` — which Gmail
 *    discards — and used `text-align:right` as a stand-in. Alignment moves a
 *    box; it does not reorder bidi runs. Here alignment is DERIVED from the
 *    resolved direction and is never a substitute for it.
 */

export type BlockRole = 'greeting' | 'body' | 'signature' | 'footer'

/**
 * Author lines joined by REAL break markup.
 *
 * `white-space: pre-line` is not a line break: Outlook desktop and Outlook.com
 * drop the declaration, which is what collapsed a multi-line signature into a
 * single line in production.
 */
export function Lines(props: { lines: string[]; emphasiseAfterFirst?: boolean }) {
  return (
    <>
      {props.lines.map((line, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <br /> : null}
          {props.emphasiseAfterFirst && i > 0 ? <strong style={{ fontWeight: 600 }}>{line}</strong> : line}
        </React.Fragment>
      ))}
    </>
  )
}

const ROLE_TYPE = {
  greeting: TYPE.greeting,
  body: TYPE.body,
  signature: TYPE.signature,
  footer: TYPE.footer,
} as const satisfies Record<BlockRole, { size: string; lineHeight: string }>

/**
 * A stack row. Owns the gap ABOVE its content, so the first row can have none
 * and no rule ever needs a matching bottom.
 */
export function Row(props: { gap?: string; children: React.ReactNode; className?: string }) {
  return (
    <tr>
      <td className={props.className} style={{ padding: 0, paddingTop: props.gap ?? '0' }}>
        {props.children}
      </td>
    </tr>
  )
}

/**
 * Author-visible copy. `direction` defaults to following the text itself, so a
 * customer writing English gets LTR copy in an otherwise Hebrew shell.
 */
export function TextBlock(props: {
  role: BlockRole
  children: React.ReactNode
  /** Resolved from `text` when omitted. */
  direction?: Direction
  /** The content used to resolve direction, when children are not plain text. */
  text?: string
  muted?: boolean
}) {
  const raw = props.text ?? (typeof props.children === 'string' ? props.children : '')
  const dir = props.direction && props.direction !== 'auto' ? props.direction : resolveDirection(raw)
  const type = ROLE_TYPE[props.role]

  return (
    <p
      dir={dir}
      lang={dir === 'rtl' ? 'he' : undefined}
      style={{
        margin: 0,
        color: props.muted ? COLOR.light.textMuted : COLOR.light.text,
        fontFamily: FONT_STACK,
        fontSize: type.size,
        lineHeight: type.lineHeight,
        fontWeight: props.role === 'greeting' ? 600 : 400,
        textAlign: alignFor(dir),
        // A pasted URL is one unbreakable token; without this it forces
        // horizontal overflow on a phone.
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
      }}
    >
      {props.children}
    </p>
  )
}

/**
 * The inbox snippet, hidden inside the message.
 *
 * Without one, Gmail's snippet is whatever the email opens with — which was the
 * greeting, "שלום דנה,". That wastes the second-most-read line in the whole
 * email. Derived, never authored: nobody should have to write a preheader.
 *
 * `mso-hide:all` keeps it out of Outlook, which ignores `display:none` here.
 */
export function Preheader(props: { text: string }) {
  return (
    <div
      dir={resolveDirection(props.text)}
      style={{
        display: 'none',
        maxHeight: 0,
        maxWidth: 0,
        overflow: 'hidden',
        opacity: 0,
        color: 'transparent',
        fontFamily: FONT_STACK,
        fontSize: '1px',
        lineHeight: '1px',
        msoHide: 'all',
      } as React.CSSProperties}
    >
      {props.text}
    </div>
  )
}

/**
 * The optional primary action — a bulletproof button.
 *
 * The colour and padding live on the `<td>`, not on the `<a>`: Outlook drops
 * padding on an anchor, which would leave a bare coloured word. The label is
 * bidi-isolated so a Hebrew label beside an LTR business name cannot reorder.
 */
export function ActionButton(props: { label: string; url: string }) {
  const dir = resolveDirection(props.label)
  return (
    <table
      role="presentation"
      border={0}
      cellPadding={0}
      cellSpacing={0}
      align={alignFor(dir) === 'right' ? 'right' : 'left'}
      style={{ borderCollapse: 'separate' }}
    >
      <tbody>
        <tr>
          <td
            align="center"
            // `bgcolor` is absent from React's <td> types but is the attribute
            // the Word engine honours most reliably. Worth keeping: a button
            // that loses its background renders a white label on white.
            {...({ bgcolor: COLOR.light.accent } as Record<string, string>)}
            style={{
              backgroundColor: COLOR.light.accent,
              borderRadius: '8px',
              padding: '14px 30px',
            }}
          >
            <a
              href={props.url}
              target="_blank"
              rel="noopener noreferrer"
              dir={dir}
              style={{
                display: 'inline-block',
                color: COLOR.light.accentText,
                fontFamily: FONT_STACK,
                fontSize: TYPE.action.size,
                lineHeight: TYPE.action.lineHeight,
                fontWeight: 600,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              <bdi>{props.label}</bdi>
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  )
}

/**
 * A 1px table row rather than `<hr>`: Outlook applies its own inset and colour
 * to a real horizontal rule.
 */
export function Divider() {
  return (
    <table
      role="presentation"
      width="100%"
      border={0}
      cellPadding={0}
      cellSpacing={0}
      style={{ width: '100%', borderCollapse: 'collapse' }}
    >
      <tbody>
        <tr>
          <td
            className="email-divider"
            style={{ height: '1px', lineHeight: '1px', fontSize: '1px', backgroundColor: COLOR.light.divider }}
          >
            &nbsp;
          </td>
        </tr>
      </tbody>
    </table>
  )
}

/**
 * The mandatory footer: who sent this, and the unsubscribe (ADR-003).
 *
 * The business name is wrapped in `<bdi>` because an interpolated Latin name
 * inside a Hebrew sentence is a directional run — without isolation, trailing
 * punctuation and any name containing digits, `&` or parentheses mis-orders.
 */
export function Footer(props: { businessName: string; unsubscribeUrl: string }) {
  return (
    <TextBlock role="footer" muted text="הודעה זו נשלחה מטעם">
      {'הודעה זו נשלחה מטעם '}
      <bdi>{props.businessName}</bdi>
      {'. '}
      <a
        href={props.unsubscribeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="email-footer-link"
        style={{
          color: COLOR.light.textMuted,
          fontFamily: FONT_STACK,
          fontSize: TYPE.footer.size,
          lineHeight: TYPE.footer.lineHeight,
          textDecoration: 'underline',
        }}
      >
        הסרה מרשימת התפוצה
      </a>
    </TextBlock>
  )
}

/** Convenience: the footer's own row, with the gap that precedes it. */
export function FooterRows(props: { businessName: string; unsubscribeUrl: string }) {
  return (
    <>
      <Row gap={SPACE.beforeFooter}>
        <Divider />
      </Row>
      <Row gap={SPACE.betweenParagraphs}>
        <Footer businessName={props.businessName} unsubscribeUrl={props.unsubscribeUrl} />
      </Row>
    </>
  )
}
