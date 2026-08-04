import { COLOR, FONT_STACK, LAYOUT, resolveDirection } from './tokens'

export function BrandHeader(props: { businessName: string; logoUrl?: string | null }) {
  const dir = resolveDirection(props.businessName)

  if (props.logoUrl) {
    return (
      <img
        src={props.logoUrl}
        alt={props.businessName}
        height={40}
        style={{
          display: 'block',
          height: '40px',
          width: 'auto',
          maxWidth: '200px',
          border: 0,
          outline: 'none',
          textDecoration: 'none',
          color: COLOR.light.text,
          fontFamily: FONT_STACK,
          fontSize: '20px',
          lineHeight: '28px',
          fontWeight: 700,
        }}
      />
    )
  }

  return (
    <p
      dir={dir}
      lang={dir === 'rtl' ? 'he' : undefined}
      className="email-text"
      style={{
        margin: 0,
        color: COLOR.light.text,
        fontFamily: FONT_STACK,
        fontSize: '20px',
        lineHeight: '28px',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        textAlign: dir === 'rtl' ? 'right' : 'left',
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
      }}
    >
      {props.businessName}
    </p>
  )
}

export function BrandRule(props: { accent: string }) {
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
            style={{
              height: '3px',
              lineHeight: '3px',
              fontSize: '1px',
              backgroundColor: props.accent,
              borderRadius: LAYOUT.radius,
            }}
          >
            &nbsp;
          </td>
        </tr>
      </tbody>
    </table>
  )
}
