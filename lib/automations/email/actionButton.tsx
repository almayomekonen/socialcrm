import { accessibleTextOn, darken } from './contrast'
import { COLOR, FONT_STACK, TYPE, alignFor, resolveDirection } from './tokens'

/**
 * The CTA action block, extracted from ./blocks so neither file carries two
 * concerns: this one owns the button and the colour derivation that keeps it
 * readable and visible, and blocks.tsx owns text and layout primitives.
 *
 * Split when blocks.tsx crossed the 250-line soft limit (architecture-rules §1).
 */

/**
 * The optional primary action — a bulletproof button.
 *
 * The colour and padding live on the `<td>`, not on the `<a>`: Outlook drops
 * padding on an anchor, which would leave a bare coloured word. The label is
 * bidi-isolated so a Hebrew label beside an LTR business name cannot reorder.
 */
export function ActionButton(props: {
  label: string
  url: string
  accent?: string
  accentText?: string
  accentBorder?: string
}) {
  const dir = resolveDirection(props.label)
  // Both derived, never configured. The label because a pale brand with the
  // default white text is unreadable and the customer cannot see that from a
  // colour picker; the edge because a pale fill on a pale surface reads as no
  // button at all.
  const accent = props.accent ?? COLOR.light.accent
  const accentText = props.accentText ?? accessibleTextOn(accent)
  const accentBorder = props.accentBorder ?? darken(accent, 0.22)
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
            {...({ bgcolor: accent } as Record<string, string>)}
            style={{
              backgroundColor: accent,
              border: `1px solid ${accentBorder}`,
              borderRadius: '8px',
              padding: '13px 29px',
            }}
          >
            <a
              href={props.url}
              target="_blank"
              rel="noopener noreferrer"
              dir={dir}
              style={{
                display: 'inline-block',
                color: accentText,
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
