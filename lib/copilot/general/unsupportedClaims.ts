/**
 * Deterministic guard against unsupported business inferences.
 * These phrases imply conversion probability, heat, or outcome that the
 * CRM facts bundle never contains.
 *
 * EVERY RULE CARRIES A FROZEN ID, and that is the whole reason this is a list of
 * objects rather than of strings. When the gate destroys an answer it must be
 * possible to say WHICH rule fired, and the rejected prose is deliberately never
 * persisted — so without an id the only record is `unsupported-claim`, which is
 * the same message for twenty-six different problems. A live 40-question
 * evaluation hit this twice, on different questions, and neither occurrence
 * could be diagnosed afterwards.
 *
 * THE IDS ARE ASSIGNED ONCE AND NEVER REUSED. They are literals rather than
 * array indices precisely so that reordering, inserting or retiring a phrase
 * cannot silently repoint an id that already appears in a trace or a durable
 * row. A new phrase takes the next unused number; a retired one leaves a gap.
 *
 * The id is safe to log: it identifies OUR phrase, not the user's text. Nothing
 * derived from the rejected content is recorded anywhere.
 */
type UnsupportedClaimRule = { id: string; phrase: string }

const BANNED: readonly UnsupportedClaimRule[] = [
  { id: 'RULE_01', phrase: 'סיכוי גבוה' },
  { id: 'RULE_02', phrase: 'סיכוי גבוה למימוש' },
  { id: 'RULE_03', phrase: 'סיכוי גבוה לסגירה' },
  { id: 'RULE_04', phrase: 'לקוח חם' },
  { id: 'RULE_05', phrase: 'ליד חם' },
  { id: 'RULE_06', phrase: 'העסקה קרובה' },
  { id: 'RULE_07', phrase: 'יגדיל המרות' },
  { id: 'RULE_08', phrase: 'יגדיל מכירות' },
  { id: 'RULE_09', phrase: 'ימנע אובדן' },
  { id: 'RULE_10', phrase: 'ימנע המשך התדרדרות' },
  { id: 'RULE_11', phrase: 'דורש טיפול מיידי' },
  { id: 'RULE_12', phrase: 'פוטנציאל גבוה' },
  { id: 'RULE_13', phrase: 'פוטנציאל עבודה שטרם מוצה' },
  { id: 'RULE_14', phrase: 'טיפול מיידי מונע' },
  { id: 'RULE_15', phrase: 'high probability' },
  { id: 'RULE_16', phrase: 'high probability of closing' },
  { id: 'RULE_17', phrase: 'hot lead' },
  { id: 'RULE_18', phrase: 'will increase conversions' },
  { id: 'RULE_19', phrase: 'increase conversions' },
  { id: 'RULE_20', phrase: 'מפסיד כסף' },
  { id: 'RULE_21', phrase: 'מאבד כסף' },
  { id: 'RULE_22', phrase: 'המרה נמוכה' },
  { id: 'RULE_23', phrase: 'יגדיל הכנסות' },
  { id: 'RULE_24', phrase: 'הליד קר' },
  { id: 'RULE_25', phrase: 'אתה מפסיד כסף' },
]

/**
 * WHICH rule fired, or null. The first match wins, and the order is the list's,
 * so a phrase that is a prefix of another reports the shorter id — which is the
 * correct, more general classification.
 */
export function matchUnsupportedBusinessClaim(text: string | null | undefined): UnsupportedClaimRule | null {
  if (!text) return null
  const t = text.toLowerCase()
  return BANNED.find((rule) => t.includes(rule.phrase.toLowerCase())) ?? null
}

/**
 * Unchanged contract, unchanged behaviour — every existing caller keeps working
 * exactly as before. It delegates so there is one matcher, not two that can
 * drift.
 */
export function containsUnsupportedBusinessClaim(text: string | null | undefined): boolean {
  return matchUnsupportedBusinessClaim(text) !== null
}

/** The rule ids, for tests that assert the set has not silently changed. */
export function unsupportedClaimRuleIds(): string[] {
  return BANNED.map((r) => r.id)
}
