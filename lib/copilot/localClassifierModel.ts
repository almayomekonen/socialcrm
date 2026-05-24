import type { Intent } from './intents'

// Feature names — the only place that defines what features exist.
// `quickClassifyIntent.ts` populates a Record<FeatureName, number> and the
// MODEL below assigns a coefficient per (intent, feature). The dot product
// of features × coefficients (plus bias) is the per-intent logit; softmax
// across intents yields the probability distribution.
export type FeatureName =
  | 'bias'
  | 'is_short_1'
  | 'is_short_2'
  | 'is_short_3'
  | 'is_long'
  | 'emoji_density'
  | 'emoji_only'
  | 'laughter'
  | 'question_mark'
  | 'imperative_start'
  | 'question_word'
  | 'file_noun'
  | 'lead_ref'
  | 'social_gratitude_full'
  | 'social_gratitude_anchored'
  | 'social_gratitude_substring'
  | 'social_greeting_full'
  | 'social_greeting_anchored'
  | 'social_greeting_substring'
  | 'social_positive_full'
  | 'social_positive_anchored'
  | 'social_positive_substring'
  | 'social_farewell_full'
  | 'social_farewell_anchored'
  | 'social_farewell_substring'

/**
 * Coefficients for the local intent classifier.
 *
 * Single source of truth for every weight in the routing layer. No weights
 * scattered across code — to tune routing behavior, edit this object.
 *
 * Structure: per intent, a partial map from feature name → coefficient.
 * Missing features default to 0 (no contribution).
 *
 * Inference (see `quickClassifyIntent.predict`):
 *   logit_i = Σ_j (coefficient_{i,j} × feature_j)
 *   probability_i = softmax(logit_i)
 *
 * These values were hand-tuned against the spec example corpus. They are
 * intended to be replaced wholesale by trained coefficients later — e.g.,
 * export a multinomial logistic regression from sklearn/pytorch as JSON,
 * load it here.
 */
export const MODEL: Record<Intent, Partial<Record<FeatureName, number>>> = {
  'social.gratitude': {
    bias: -1.0,
    social_gratitude_full: 5.0,
    social_gratitude_anchored: 4.0,
    social_gratitude_substring: 2.0,
    is_short_1: 0.8,
    is_short_2: 0.5,
    emoji_density: 0.8,
    question_mark: -2.0,
    question_word: -2.0,
    file_noun: -1.5,
    imperative_start: -2.5,
    is_long: -0.8,
  },
  'social.greeting': {
    bias: -1.0,
    social_greeting_full: 5.0,
    social_greeting_anchored: 4.0,
    social_greeting_substring: 2.0,
    is_short_1: 0.5,
    is_short_2: 0.5,
    emoji_density: 0.5,
    question_mark: -2.0,
    question_word: -2.0,
    imperative_start: -2.5,
    file_noun: -1.5,
    is_long: -0.8,
  },
  'social.positive': {
    bias: -1.0,
    social_positive_full: 5.0,
    social_positive_anchored: 4.0,
    social_positive_substring: 2.0,
    is_short_1: 0.5,
    is_short_2: 0.5,
    emoji_density: 0.8,
    emoji_only: 3.0,
    laughter: 1.5,
    question_mark: -1.5,
    question_word: -2.0,
    imperative_start: -2.5,
    file_noun: -1.5,
    is_long: -0.8,
  },
  'social.farewell': {
    bias: -1.0,
    social_farewell_full: 5.0,
    social_farewell_anchored: 4.0,
    social_farewell_substring: 2.0,
    is_short_1: 0.5,
    is_short_2: 0.5,
    question_mark: -2.0,
    question_word: -2.0,
    imperative_start: -2.5,
    file_noun: -1.5,
    is_long: -0.8,
  },
  task: {
    bias: -3.0,
    imperative_start: 5.0,
    is_short_3: 0.3,
    is_long: 0.5,
    lead_ref: 1.0,
    question_mark: -1.5,
    file_noun: -2.0,
  },
  crm: {
    bias: -3.0,
    question_mark: 2.0,
    question_word: 2.5,
    lead_ref: 1.5,
    is_long: 0.3,
    imperative_start: -1.0,
  },
  search: {
    bias: -3.0,
    file_noun: 4.5,
    imperative_start: 2.0,
    is_short_2: 0.5,
    question_mark: -1.0,
  },
  unknown: {
    bias: 0.5,
  },
}
