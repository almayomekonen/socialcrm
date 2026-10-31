import type { MessageKey, Translator } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The card holder refusal in the form's language (i18n Phase F5).
 *
 * `startCardSetup` answers `invalid_holder` with a field and a HEBREW sentence
 * (`validateCardHolder` in lib/payments/cardTrial/cardHolder.ts, and the same
 * sentence for a missing previous holder). The action and the validation are
 * not touched: the sentence is matched EXACTLY here and worded from
 * `trial.holder.*`. Hebrew returns the sentence as received; an unknown sentence
 * is shown as received in every language. Pinned in trialCopyPin.test.ts.
 */
const HE = translatorFor('he')
const KEYS: MessageKey[] = ['trial.holder.fullName', 'trial.holder.phone']

export function holderMessageText(message: string, t: Translator): string {
  if (t.locale === 'he') return message
  const key = KEYS.find((k) => HE(k) === message)
  return key ? t(key) : message
}
