import * as React from 'react'
import { COLOR, FONT_STACK, LAYOUT, SPACE } from './tokens'

/**
 * The document shell: everything around the customer's content.
 *
 * Layering, and why:
 *
 * - INLINE styles carry the light-mode design. They survive every sanitizer, so
 *   they are the floor.
 * - An embedded `<style>` adds dark mode and the mobile gutter. Gmail supports
 *   embedded styles; clients that strip them fall back to the inline light
 *   design rather than to something broken.
 * - `color-scheme` / `supported-color-schemes` tell a dark-mode client that we
 *   have handled the inversion. Declaring a background without a foreground —
 *   which is what the pre-Phase-1 renderer did — is the most reliable way to end
 *   up with unreadable text.
 *
 * `max-width` is the only width control, and the Word engine ignores it, so
 * Outlook desktop renders full-width. That is an accepted, documented limitation
 * of the agreed client bar (Gmail + Apple Mail first-class, Outlook best-effort);
 * MSO ghost tables are deliberately out of scope.
 */

const DARK_AND_MOBILE_CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
/* Some clients need a nudge to leave our colours alone. */
[data-ogsc] .email-surface { background-color: ${COLOR.dark.surface} !important; }
@media (prefers-color-scheme: dark) {
  .email-canvas { background-color: ${COLOR.dark.canvas} !important; }
  .email-surface { background-color: ${COLOR.dark.surface} !important; }
  .email-divider { background-color: ${COLOR.dark.divider} !important; }
  p, .email-text { color: ${COLOR.dark.text} !important; }
  .email-muted, .email-muted p, .email-footer-link { color: ${COLOR.dark.textMuted} !important; }
}
@media only screen and (max-width: 620px) {
  .email-gutter { padding: ${SPACE.gutterMobile} !important; }
  .email-shell { width: 100% !important; }
}
`.trim()

export function Shell(props: { children: React.ReactNode; preheader?: React.ReactNode }) {
  return (
    <html dir="rtl" lang="he">
      <head>
        <meta httpEquiv="Content-Type" content="text/html; charset=UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <title>הודעה מהעסק</title>
        <style dangerouslySetInnerHTML={{ __html: DARK_AND_MOBILE_CSS }} />
      </head>
      <body
        className="email-canvas"
        style={{
          margin: 0,
          padding: 0,
          width: '100%',
          backgroundColor: COLOR.light.canvas,
          color: COLOR.light.text,
          fontFamily: FONT_STACK,
        }}
      >
        {props.preheader}
        <table
          role="presentation"
          className="email-canvas"
          width="100%"
          border={0}
          cellPadding={0}
          cellSpacing={0}
          style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: COLOR.light.canvas }}
        >
          <tbody>
            <tr>
              {/* `dir` here too: it is the outermost element that survives a
                  re-hosting client, so it gives every block a correct base even
                  before each block declares its own. */}
              <td
                dir="rtl"
                align="center"
                style={{
                  paddingTop: SPACE.shellTop,
                  paddingBottom: SPACE.shellBottom,
                  paddingLeft: '12px',
                  paddingRight: '12px',
                }}
              >
                <table
                  role="presentation"
                  className="email-shell"
                  align="center"
                  width="100%"
                  border={0}
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    width: '100%',
                    maxWidth: `${LAYOUT.contentWidth}px`,
                    borderCollapse: 'collapse',
                  }}
                >
                  <tbody>
                    <tr>
                      {/* Padding on the CELL. The Word engine ignores padding on
                          a `<table>`, which is how the copy ended up flush
                          against the edge of the message in Outlook. */}
                      <td
                        className="email-surface email-gutter"
                        style={{
                          padding: SPACE.gutter,
                          backgroundColor: COLOR.light.surface,
                          borderRadius: LAYOUT.radius,
                        }}
                      >
                        <table
                          role="presentation"
                          width="100%"
                          border={0}
                          cellPadding={0}
                          cellSpacing={0}
                          style={{ width: '100%', borderCollapse: 'collapse' }}
                        >
                          <tbody>{props.children}</tbody>
                        </table>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  )
}
