/**
 * The workflow illustrations — trigger on the leading edge, outcome on the
 * trailing one, read right-to-left like the rest of the page.
 *
 * WHY THESE ARE INLINE SVG AND NOT `lib/Icon`: that component is a CSS mask
 * (`maskImage` + a background colour), so every glyph it draws is exactly ONE
 * colour. These scenes need a neutral source, a grey connector and a coloured
 * action in the same drawing, which a mask physically cannot express.
 *
 * The vocabulary is fixed, and every scene is built from it rather than drawn
 * freehand:
 *
 *   · the SOURCE, neutral                       `#98a3b8`
 *   · the CONNECTOR, lighter, dashed when the step is delayed  `#c4cad3`
 *   · the WAYPOINT, the one accent mark         `--color-primary`  #5e6ad2
 *   · the OUTCOME, tinted by its channel        mail #3b6fbf · calendar #c98a20
 *
 * One 104×44 canvas for all of them, so the six line up across the grid on a
 * shared baseline. Keyed by TEMPLATE KEY, with a neutral fallback, so a new
 * template renders something honest instead of nothing.
 */

const NEUTRAL = '#98a3b8'
const LINE = '#c4cad3'
const ACCENT = '#5e6ad2'
const MAIL = '#3b6fbf'
const CALENDAR = '#c98a20'
/**
 * The money tint. It extends the existing rule rather than breaking it — the
 * outcome is "tinted by its channel", and a priced document is a third channel
 * beside mail and calendar. Muted to the same degree as those two, so it reads
 * as premium rather than as a banking app.
 */
const MONEY = '#2f9670'
/** A whisper of the accent, for the one row that carries the total. */
const ACCENT_WASH = '#f3f4fc'
/** The page background, used where a shape sits over the connector. */
const RECESS = '#f4f5f7'

/** The leftward arrowhead every scene ends with, positioned per scene. */
function Arrow({ y }: { y: number }) {
  return <path d={`M43.5 ${y - 4} 40 ${y} 43.5 ${y + 4}`} stroke={LINE} strokeWidth='1.3' />
}

const SCENES: Record<string, React.ReactNode> = {
  // Website form → email, confirmed.
  website_lead_follow_up: (
    <>
      <rect x='76' y='9' width='24' height='21' rx='3.5' stroke={NEUTRAL} />
      <path d='M76 15.5h24' stroke={NEUTRAL} strokeWidth='1.3' />
      <circle cx='79.5' cy='12.3' r='1' fill={NEUTRAL} />
      <rect x='79.5' y='18.5' width='17' height='3.6' rx='1.8' fill={RECESS} />
      <path d='M86 24.5l5.6 6.6.5-2.9 2.8-.6z' stroke={NEUTRAL} strokeWidth='1.3' />
      <path d='M74 20H62a6 6 0 0 0-6 6H40' stroke={LINE} strokeWidth='1.3' />
      <circle cx='56' cy='23' r='2.4' fill={ACCENT} />
      <Arrow y={26} />
      <rect x='4' y='17' width='23' height='16' rx='3' stroke={MAIL} />
      <path d='M5.6 19.2 15.5 27 25.4 19.2' stroke={MAIL} strokeWidth='1.4' />
      <circle cx='27' cy='32' r='4.2' fill='#fff' stroke={MAIL} strokeWidth='1.3' />
      <path d='M25.2 32l1.3 1.4 2.4-2.7' stroke={MAIL} strokeWidth='1.3' />
    </>
  ),

  // New lead → a sequence of emails. The dashed run and the second envelope
  // behind the first are what say "more than one message".
  welcome_sequence: (
    <>
      <circle cx='88' cy='13' r='5' stroke={NEUTRAL} />
      <path d='M79 29a9 9 0 0 1 18 0' stroke={NEUTRAL} />
      <path d='M74 20H40' stroke={LINE} strokeWidth='1.3' strokeDasharray='1.6 4' />
      <path d='M66 17.5v5M58 17.5v5M50 17.5v5' stroke={LINE} strokeWidth='1.1' />
      <circle cx='58' cy='20' r='2.4' fill={ACCENT} />
      <Arrow y={20} />
      <rect x='9' y='12' width='23' height='16' rx='3' stroke={LINE} strokeWidth='1.2' />
      <rect x='4' y='17' width='23' height='16' rx='3' fill='#fff' stroke={MAIL} />
      <path d='M5.6 19.2 15.5 27 25.4 19.2' stroke={MAIL} strokeWidth='1.4' />
    </>
  ),

  // Status changed → a wait → a fresh approach.
  lost_lead_follow_up: (
    <>
      <rect x='76' y='5' width='24' height='17' rx='3.5' stroke={NEUTRAL} />
      <circle cx='81.5' cy='11' r='2.3' stroke={NEUTRAL} strokeWidth='1.2' />
      <path d='M86.5 11H96M80 17H94' stroke={NEUTRAL} strokeWidth='1.2' />
      <path d='M74 13.5H63a5 5 0 0 0-5 5v6a5 5 0 0 1-5 5H40' stroke={LINE} strokeWidth='1.3' strokeDasharray='1.6 4' />
      <circle cx='58' cy='21.5' r='5.2' fill='#fff' stroke={LINE} strokeWidth='1.3' />
      <path d='M58 18.4v3.3l2.2 1.5' stroke={ACCENT} strokeWidth='1.4' />
      <Arrow y={29.5} />
      <rect x='4' y='21' width='23' height='16' rx='3' stroke={MAIL} />
      <path d='M5.6 23.2 15.5 31 25.4 23.2' stroke={MAIL} strokeWidth='1.4' />
    </>
  ),

  // Form submitted → immediate acknowledgement.
  contact_form_thank_you: (
    <>
      <rect x='76' y='6' width='24' height='27' rx='3.5' stroke={NEUTRAL} />
      <rect x='79.5' y='11' width='17' height='3.6' rx='1.8' fill={RECESS} />
      <rect x='79.5' y='17.5' width='17' height='3.6' rx='1.8' fill={RECESS} />
      <circle cx='83' cy='27.5' r='3.6' stroke={ACCENT} strokeWidth='1.3' />
      <path d='M81.4 27.5l1.3 1.4 2.4-2.7' stroke={ACCENT} strokeWidth='1.3' />
      <path d='M74 20H40' stroke={LINE} strokeWidth='1.3' />
      <circle cx='57' cy='20' r='2.4' fill={ACCENT} />
      <Arrow y={20} />
      <rect x='4' y='14' width='25' height='18' rx='3.5' stroke={MAIL} />
      <path d='M5.8 16.4 16.5 25 27.2 16.4' stroke={MAIL} strokeWidth='1.4' />
      <path d='M8 9.5h8' stroke={LINE} strokeWidth='1.2' />
    </>
  ),

  // Meeting booked → the reminder fires before it.
  appointment_reminder: (
    <>
      <rect x='76' y='8' width='24' height='23' rx='3.5' stroke={NEUTRAL} />
      <path d='M76 15h24' stroke={NEUTRAL} strokeWidth='1.3' />
      <path d='M82 4.5v5M94 4.5v5' stroke={NEUTRAL} strokeWidth='1.4' />
      <rect x='89.5' y='18.5' width='7' height='7' rx='2' fill='#fdf6ea' stroke={CALENDAR} strokeWidth='1.2' />
      <path d='M74 20H40' stroke={LINE} strokeWidth='1.3' strokeDasharray='1.6 4' />
      <path d='M67 17.5v5M59 17.5v5M51 17.5v5' stroke={LINE} strokeWidth='1.1' />
      <circle cx='51' cy='20' r='2.4' fill={ACCENT} />
      <Arrow y={20} />
      <path d='M12 24c0-6.5 1-10 6.5-10s6.5 3.5 6.5 10' stroke={CALENDAR} />
      <path d='M8.5 24h21' stroke={CALENDAR} />
      <path d='M15.5 27.5a3.2 3.2 0 0 0 6 0' stroke={CALENDAR} />
      <path d='M5 19.5a9 9 0 0 1 2.2-6' stroke={CALENDAR} strokeWidth='1.2' opacity='.45' />
      <path d='M33 19.5a9 9 0 0 0-2.2-6' stroke={CALENDAR} strokeWidth='1.2' opacity='.45' />
    </>
  ),

  /**
   * A lead's message becomes a priced quotation, ready for the rep.
   *
   * The densest scene in the set, deliberately: the quotation is the HERO, so it
   * occupies the full height of the canvas rather than the ~20px the other
   * outcomes take, and the two objects nearly meet in the middle so no dead band
   * opens between them.
   *
   * Same fixed vocabulary throughout — RECESS bars for content, the grey
   * connector with its one indigo waypoint, badges overlapping an edge exactly
   * as `website_lead_follow_up` and `internal_task_on_new_lead` already do. The
   * quotation's outline is ACCENT because nothing is sent to the customer; the
   * money marks are MONEY, which is the outcome tint this scene introduces.
   *
   * The connector is SOLID, not dashed. Dashes mean "delayed" in this file, and
   * this automation runs immediately — drawing a wait that does not happen would
   * be the one thing an honest scene may not do.
   *
   * The ONE departure from the file's shapes-only rule is the ₪ glyph as
   * `<text>`: the currency mark is the point of the scene, and every path
   * approximation of it is unreadable at this size.
   */
  quote_on_lead_stage: (
    <>
      {/* The lead's message. */}
      <rect x='68' y='6' width='32' height='20' rx='5' stroke={MONEY} />
      <path d='M74 25.5v5l5-5' stroke={MONEY} strokeWidth='1.4' />
      <rect x='72' y='11' width='18' height='2.8' rx='1.4' fill={RECESS} />
      <rect x='72' y='16.5' width='12' height='2.8' rx='1.4' fill={RECESS} />

      {/* The automation — one waypoint, the same mark every scene uses. */}
      <path d='M66 22H44' stroke={LINE} strokeWidth='1.3' />
      <circle cx='55' cy='22' r='2.5' fill={ACCENT} />
      <Arrow y={22} />

      {/* The quotation — header, priced rows, total. */}
      <rect x='3' y='3' width='34' height='38' rx='4' stroke={ACCENT} />
      <rect x='7' y='7.5' width='16' height='3.4' rx='1.7' fill={RECESS} />
      <path d='M3 14.5H37' stroke={ACCENT} strokeWidth='1' opacity='.3' />
      <rect x='7' y='18.5' width='14' height='2.8' rx='1.4' fill={RECESS} />
      <rect x='26' y='18.5' width='7' height='2.8' rx='1.4' fill={RECESS} />
      <rect x='7' y='24' width='17' height='2.8' rx='1.4' fill={RECESS} />
      <rect x='26' y='24' width='7' height='2.8' rx='1.4' fill={RECESS} />
      <rect x='7' y='29.5' width='11' height='2.8' rx='1.4' fill={RECESS} />
      <rect x='26' y='29.5' width='7' height='2.8' rx='1.4' fill={RECESS} />
      <path d='M7 34.5H33' stroke={LINE} strokeWidth='1' />
      {/* The total, and the amount it comes to. */}
      <rect x='7' y='36' width='12' height='3.4' rx='1.7' fill={ACCENT_WASH} />
      <circle cx='29' cy='37.6' r='5.4' fill='#fff' stroke={MONEY} strokeWidth='1.3' />
      <text x='29' y='40.4' textAnchor='middle' fontSize='8' fontWeight='700' fill={MONEY} stroke='none'>
        ₪
      </text>
      {/* Ready for the rep. */}
      <circle cx='36' cy='7' r='4.2' fill='#fff' stroke={MONEY} strokeWidth='1.2' />
      <path d='M34.2 7l1.3 1.4 2.4-2.7' stroke={MONEY} strokeWidth='1.3' />
    </>
  ),

  // New lead → a task lands on the rep on duty.
  internal_task_on_new_lead: (
    <>
      <rect x='76' y='9' width='24' height='19' rx='3.5' stroke={NEUTRAL} />
      <circle cx='81.5' cy='15.5' r='2.3' stroke={NEUTRAL} strokeWidth='1.2' />
      <path d='M86.5 15.5H96M80 22H94' stroke={NEUTRAL} strokeWidth='1.2' />
      <path d='M74 19H40' stroke={LINE} strokeWidth='1.3' />
      <circle cx='57' cy='19' r='2.4' fill={ACCENT} />
      <Arrow y={19} />
      <circle cx='16' cy='12' r='5' stroke={ACCENT} />
      <path d='M7 28a9 9 0 0 1 18 0' stroke={ACCENT} />
      <rect x='22' y='21' width='11' height='11' rx='3' fill='#f3f4fc' stroke={ACCENT} strokeWidth='1.3' />
      <path d='M24.4 26.5l1.9 2 3.8-4.2' stroke={ACCENT} strokeWidth='1.3' />
    </>
  ),
}

/** Something happens, then something follows. True of every automation. */
const FALLBACK = (
  <>
    <rect x='76' y='11' width='24' height='18' rx='3.5' stroke={NEUTRAL} />
    <path d='M74 20H40' stroke={LINE} strokeWidth='1.3' />
    <circle cx='57' cy='20' r='2.4' fill={ACCENT} />
    <Arrow y={20} />
    <rect x='4' y='11' width='24' height='18' rx='3.5' stroke={ACCENT} />
  </>
)

export default function AutomationFlowArt({ templateKey }: { templateKey: string }) {
  return (
    <svg
      width='96'
      height='42'
      viewBox='0 0 104 44'
      fill='none'
      strokeWidth='1.6'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      {SCENES[templateKey] ?? FALLBACK}
    </svg>
  )
}
