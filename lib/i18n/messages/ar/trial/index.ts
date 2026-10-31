import type { Messages } from '../../../translate'
import { welcome, expired, celebration } from './gate'
import { verifier, holder } from './card'

export const trial: Messages['trial'] = { welcome, expired, celebration, verifier, holder }
