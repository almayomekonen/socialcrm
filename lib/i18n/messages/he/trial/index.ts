/**
 * Trial gate and card return namespace (Phase F5): the screens the (app)
 * layout renders for NEVER_STARTED / TRIAL_EXPIRED / just-activated workspaces,
 * and `/billing/success`. Chrome only — no billing, payment or trial rule.
 */
import { welcome, expired, celebration } from './gate'
import { verifier, holder } from './card'

export const trial = { welcome, expired, celebration, verifier, holder } as const
