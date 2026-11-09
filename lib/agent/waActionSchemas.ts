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

/**
 * Changes to a record that already exists. The model never gives the record's
 * id: it names the lead and repeats how the owner described the record, and the
 * application finds it inside the agency (lib/waAssistant/recordChanges/).
 */
export const updateTaskProposal = z.object({
  actionType: z.literal('update_task'),
  args: z.object({
    clientId: z.number(),
    /** The owner's words identifying the task, or null when they gave none. */
    match: z.string().nullable(),
    /** The new title in the owner's words, or null to keep it. */
    newTitle: z.string().nullable(),
    /** The owner's exact words about the new day, or null to keep it. */
    newWhen: z.string().nullable(),
  }),
  evidenceRefs: z.array(z.string()),
})

export const completeTaskProposal = z.object({
  actionType: z.literal('complete_task'),
  args: z.object({ clientId: z.number(), match: z.string().nullable() }),
  evidenceRefs: z.array(z.string()),
})

export const rescheduleMeetingProposal = z.object({
  actionType: z.literal('reschedule_meeting'),
  args: z.object({
    clientId: z.number(),
    /** The owner's words identifying the existing appointment, or null. */
    match: z.string().nullable(),
    /** The owner's exact words about the NEW time only, or null. */
    newWhen: z.string().nullable(),
  }),
  evidenceRefs: z.array(z.string()),
})

export const cancelMeetingProposal = z.object({
  actionType: z.literal('cancel_meeting'),
  args: z.object({ clientId: z.number(), match: z.string().nullable() }),
  evidenceRefs: z.array(z.string()),
})
