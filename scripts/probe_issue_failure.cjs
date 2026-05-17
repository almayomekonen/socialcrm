require('dotenv').config({ path: '.env.local' })
const knex = require('knex')({
  client: 'pg',
  connection: { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } },
})

;(async () => {
  try {
    const recent = await knex('bill_invoices')
      .where({ agencyId: 27 })
      .orderBy('id', 'desc')
      .limit(5)
      .select(
        'id', 'docState', 'fulfillState', 'kind',
        'paymentMethod', 'paymentAmount', 'paymentDate', 'paymentReceived',
        'paymentMethodSnapshot', 'paymentAmountSnapshot', 'paymentDateSnapshot',
        'totalAmount', 'createdAt', 'updatedAt',
      )
    console.log('Recent invoices on agency 27 (newest first):')
    console.table(recent)

    if (recent.length > 0) {
      const lines = await knex('bill_invoice_lines')
        .where({ invoiceId: recent[0].id })
        .select('id', 'lineNumber', 'title', 'quantity', 'unitPrice', 'lineTotal')
      console.log(`\nLines for invoice ${recent[0].id}:`)
      console.table(lines)
    }

    const events = await knex('bill_financial_events')
      .where({ agencyId: 27 })
      .orderBy('id', 'desc')
      .limit(8)
      .select('id', 'invoiceId', 'eventType', 'occurredAt', 'payload')
    console.log('\nRecent financial events:')
    console.table(events)
  } finally {
    await knex.destroy()
  }
})()
