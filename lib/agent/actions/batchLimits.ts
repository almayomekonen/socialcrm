/**
 * How many leads one batch may touch.
 *
 * Ten is a product decision, not a technical one. It is the size a rep can
 * actually read on a card before approving — the point of showing the targets is
 * that someone looks at them — and it is roughly the size of a real "leads with
 * no next step" backlog in the agencies this serves. A hundred tasks created
 * from one sentence is not a batch, it is an accident with a receipt.
 *
 * OVER-LIMIT IS AN ANSWER, NOT A TRIM. Executing the first ten of forty-seven
 * silently would leave the rep believing the job was done. The batch is refused
 * whole, with the real count, so they can narrow the request themselves.
 */
export const MAX_BATCH_TARGETS = 10
