/**
 * WhatsApp Coexistence `history` webhook fixtures.
 *
 * DERIVED FROM META'S PUBLISHED EXAMPLES, not from a captured payload. Field
 * names, nesting, types, array structure and optionality are preserved exactly
 * as documented; every VALUE is synthetic.
 *
 * Sanitization: phone numbers are `1555000####` reserved-style fakes, wamids are
 * structurally valid but meaningless, and message bodies are neutral filler. No
 * real customer, business, token or identifier appears here, and none ever
 * should — this file is committed, and a real archive is bulk personal message
 * content.
 *
 * The one thing kept faithful is SHAPE, because shape is the entire contract
 * this fixture exists to pin.
 */

export const BUSINESS_NUMBER = '15550001111'
export const BUSINESS_PHONE_ID = '100000000000001'
export const WABA_ID = '200000000000002'

export const CUSTOMER_A = '15550002222'
export const CUSTOMER_B = '15550003333'

export const WAMID_A1 = 'wamid.SYNTHETICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1'
export const WAMID_A2 = 'wamid.SYNTHETICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2'
export const WAMID_A3 = 'wamid.SYNTHETICAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3'
export const WAMID_B1 = 'wamid.SYNTHETICBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1'

/** Unix seconds AS A STRING — the documented representation. */
export const TS_A1 = '1739230955'
export const TS_A2 = '1739230970'
export const TS_A3 = '1739230985'

const metadata = { display_phone_number: BUSINESS_NUMBER, phone_number_id: BUSINESS_PHONE_ID }

/** Wrap a `value` in the documented `entry[].changes[]` envelope. */
export function envelope(value: unknown, field = 'history') {
  return { object: 'whatsapp_business_account', entry: [{ id: WABA_ID, changes: [{ value, field }] }] }
}

/**
 * Shape 1 — a history chunk. Covers fixture requirements A–J:
 * two threads, multiple messages, phase/chunk_order/progress, history_context
 * status, an SMB echo carrying `to`, a customer message with no `to`, and a
 * media_placeholder.
 */
export const HISTORY_CHUNK_VALUE = {
  messaging_product: 'whatsapp',
  metadata,
  history: [
    {
      metadata: { phase: 0, chunk_order: 1, progress: 55 },
      threads: [
        {
          id: CUSTOMER_A,
          messages: [
            {
              // Business → customer. An SMB echo, so `to` IS present.
              from: BUSINESS_NUMBER,
              to: CUSTOMER_A,
              id: WAMID_A1,
              timestamp: TS_A1,
              type: 'text',
              text: { body: 'Synthetic outbound body' },
              history_context: { status: 'READ' },
            },
            {
              // Media without contents. No `text`; a follow-up webhook may carry it.
              from: BUSINESS_NUMBER,
              id: WAMID_A2,
              timestamp: TS_A2,
              type: 'media_placeholder',
              history_context: { status: 'PLAYED' },
            },
            {
              // Customer → business. NO `to` — the documented customer case.
              from: CUSTOMER_A,
              id: WAMID_A3,
              timestamp: TS_A3,
              type: 'text',
              text: { body: 'Synthetic inbound body' },
              history_context: { status: 'READ' },
            },
          ],
        },
        {
          id: CUSTOMER_B,
          messages: [
            {
              from: BUSINESS_NUMBER,
              id: WAMID_B1,
              timestamp: TS_A2,
              type: 'text',
              text: { body: 'Synthetic second thread' },
              history_context: { status: 'DELIVERED' },
            },
          ],
        },
      ],
    },
  ],
}

/**
 * Shape 2 — the media follow-up (K). A TOP-LEVEL `messages[]`, no `history`,
 * no threads, same `field: "history"`. It reuses WAMID_A2, mirroring Meta's
 * example; the parser must NOT treat that as a guaranteed correlation.
 */
export const HISTORY_MEDIA_FOLLOWUP_VALUE = {
  messaging_product: 'whatsapp',
  metadata,
  messages: [
    {
      from: CUSTOMER_A,
      id: WAMID_A2,
      timestamp: TS_A2,
      type: 'image',
      image: {
        caption: 'Synthetic caption',
        mime_type: 'image/jpeg',
        sha256: '0000000000000000000000000000000000000000000000000000000000000000',
        id: '300000000000003',
      },
    },
  ],
}

/** Shape 3 — the documented decline (L). Meta publishes it WITHOUT the envelope. */
export const HISTORY_ERROR_VALUE = {
  messaging_product: 'whatsapp',
  metadata,
  history: [
    {
      errors: [
        {
          code: 2593109,
          title: 'History sync is turned off by the business from the WhatsApp Business App',
          message: 'History sync is turned off by the business from the WhatsApp Business App',
          error_data: { details: 'History sharing is turned off by the business' },
        },
      ],
    },
  ],
}

/** A chunk whose messages each break one rule, for the rejection tests. */
export const HISTORY_DEGRADED_VALUE = {
  messaging_product: 'whatsapp',
  metadata,
  history: [
    {
      metadata: { phase: 2, chunk_order: 7, progress: 100 },
      threads: [
        {
          id: CUSTOMER_A,
          messages: [
            { from: CUSTOMER_A, timestamp: TS_A1, type: 'text', text: { body: 'no wamid' } },
            { from: CUSTOMER_A, id: WAMID_A1, timestamp: 'not-a-number', type: 'text', text: { body: 'bad ts' } },
            {
              // A type the adapter does not map. Preserved, never discarded.
              from: CUSTOMER_A,
              id: WAMID_A3,
              timestamp: TS_A3,
              type: 'order_status_update',
              order_status_update: { status: 'shipped' },
              history_context: { status: 'SENT' },
            },
          ],
        },
        // A thread with no id — no customer identity, so nothing can attach.
        { messages: [{ from: CUSTOMER_B, id: WAMID_B1, timestamp: TS_A1, type: 'text', text: { body: 'x' } }] },
      ],
    },
  ],
}
