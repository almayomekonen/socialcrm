/**
 * Shape of a lead-row consumable by LeadPicker. Mirrors the columns
 * read server-side (id + searchable name fields + invoice count).
 * Lives here so consumers don't pull from db/billing/* or duplicate
 * the shape inline.
 */
export type RecentLead = {
  id: number
  details: string | null
  firstName: string | null
  lastName: string | null
  idNum: string | null
  /** Number of invoices on file. 0 means "lead exists but not yet billed". */
  invoiceCount?: number
}
