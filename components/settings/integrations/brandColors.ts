/**
 * Brand tints for integration icons on Settings → אינטגרציות.
 *
 * WHY THESE ARE STRINGS OF CLASSES AND NOT JUST A COLOUR:
 * `@/lib/Icon` renders every icon as a CSS mask, so an icon is a silhouette
 * filled by its `bg-*` class. Colouring one therefore means overriding that
 * class — and inside an accordion it must be overridden twice, because the
 * default turns the icon brand-purple on open. Without the `group-open`
 * variant a Facebook icon would go purple exactly when the user opens the
 * Facebook row.
 *
 * WHEN NOT TO USE THIS FILE AT ALL:
 * a mask cannot carry more than one colour, so a tint is only honest for marks
 * that ARE one colour — Facebook's blue, WhatsApp's green. Multi-colour marks
 * (Google Drive's blue/green/yellow prism, Google Calendar's four-colour grid)
 * ship as real SVG files in `public/media/social-icons/` and are rendered with
 * `<img>` via the `logoSrc` field on the integration descriptor. Tinting one of
 * those a single colour produces a plausible-looking logo that is not the
 * brand's — worse than no colour at all.
 *
 * Values are the official brand hexes so the tint is recognisable rather than
 * approximate.
 */

/**
 * EVERY CLASS BELOW IS WRITTEN OUT IN FULL, ON PURPOSE.
 *
 * Tailwind's JIT scans source text for complete class names; it does not
 * evaluate code. A helper like `` const persist = (hex) => `bg-[${hex}]` ``
 * reads beautifully and produces classes that are never generated, so the
 * icons would render with no fill at all. Repetition here is the price of the
 * classes actually existing in the stylesheet.
 */
export const BRAND = {
  /** Facebook blue. */
  facebook: 'bg-[#1877F2] group-open/acrdn:bg-[#1877F2]',
  /** WhatsApp green. */
  whatsapp: 'bg-[#25D366] group-open/acrdn:bg-[#25D366]',
  /**
   * WhatsApp green, matching the וואטסאפ row above it. These templates are a
   * WhatsApp asset — Meta approves them and they cannot be sent anywhere else —
   * so the icon says WhatsApp and the title (הודעות WhatsApp מוכנות) does the
   * distinguishing. A violet chat glyph read as a generic saved-messages
   * feature, which is exactly the association to avoid.
   */
  templates: 'bg-[#25D366] group-open/acrdn:bg-[#25D366]',
  /**
   * Neutral slate rather than blue, deliberately. The website row shows a globe
   * in its header AND a second globe on the connection card inside it, and that
   * card's icon comes from the automations catalog's frozen `IntegrationDefinition`
   * contract, which carries no colour field. Tinting only the header would leave
   * two different-coloured globes in the same open row. Neutral keeps them
   * matched until the contract gains a colour field.
   */
  website: 'bg-slate-600 group-open/acrdn:bg-slate-600',
} as const
