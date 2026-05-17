import { COLOR, SP, TRACKING, TYPE } from '../styles'

// Customer-facing note above an optional quiet issuer byline. Renders
// nothing if neither input is present — never leaves an empty section.

export function DocumentFooter({
  customerFooter,
  displayName,
}: {
  customerFooter: string
  displayName: string
}) {
  const note = customerFooter?.trim() ?? ''
  const issuerByline = displayName?.trim() ?? ''
  if (!note && !issuerByline) return null

  return (
    <footer
      style={{
        marginTop: SP.xxxl,
        paddingTop: SP.lg,
        borderTop: `1px solid ${COLOR.ruleSoft}`,
      }}
    >
      {note && (
        <>
          <div
            style={{
              fontSize: TYPE.label,
              color: COLOR.label,
              letterSpacing: TRACKING.caps,
              textTransform: 'uppercase',
              fontWeight: 600,
              marginBottom: SP.sm,
            }}
          >
            הערה ללקוח
          </div>
          <div
            style={{
              fontSize: TYPE.body,
              color: COLOR.body,
              lineHeight: 1.65,
              whiteSpace: 'pre-line',
            }}
          >
            {note}
          </div>
        </>
      )}
      {issuerByline && (
        <div
          style={{
            marginTop: note ? SP.xl : 0,
            fontSize: TYPE.footnote,
            color: COLOR.mute,
            textAlign: 'center',
            letterSpacing: TRACKING.caps,
          }}
        >
          {issuerByline}
        </div>
      )}
    </footer>
  )
}
