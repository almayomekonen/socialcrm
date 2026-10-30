/**
 * Billing namespace (Phase E3) — the invoice editors, the issued view, the send
 * dialog, the issuer step and the shared lead picker. SCREEN CHROME ONLY: the
 * legal document (PDF, numbering, snapshots, the e-mail) follows the billing
 * locale and is never worded from this catalog. The lead billing LIST is
 * `leadTabs.billing` (Phase C), reused here for states and kinds.
 */
import { editor } from './editor'
import { issued } from './issued'
import { send } from './send'
import { issuer } from './issuer'
import { paymentMethod, issueError, picker } from './labels'

export const billing = { editor, issued, send, issuer, paymentMethod, issueError, picker } as const
