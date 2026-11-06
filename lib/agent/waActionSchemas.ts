import { z } from 'zod'

/**
 * WhatsApp-only actions (the web Agent drops them: its action card cannot
 * render them). Both target a lead, so the gate's evidence rule covers them.
 */
export const updateLeadStatusProposal = z.object({
  actionType: z.literal('update_lead_status'),
  args: z.object({
    clientId: z.number(),
    /** One of the five SocialCRM status codes: new | contacted | interested | closed | lost. */
    status: z.string(),
  }),
  evidenceRefs: z.array(z.string()),
})

export const addLeadNoteProposal = z.object({
  actionType: z.literal('add_lead_note'),
  args: z.object({
    clientId: z.number(),
    /** What the user asked to record, in their own words. */
    content: z.string(),
  }),
  evidenceRefs: z.array(z.string()),
})
