import 'server-only'
import crypto from 'node:crypto'
import { db } from '@/config/db'
import { insertLeadSystem } from '@/lib/system/insertLeadSystem'
import { getQuotaStatus } from '@/lib/quota'
import { emitAutomationEvent } from '../emit'
import type { Connection, ConnectionOption, Source } from '../catalog/types'
import type { ConnectionProvider, MappedEvent, SetupGuide } from './types'

/**
 * The Contact Form 7 connector — the first PRODUCTION integration.
 *
 * Everything WordPress-specific in this system is in this one file. Above it
 * nothing knows CF7 exists: the Builder renders catalog metadata, the worker
 * executes actions, the ingest route resolves connectors by path segment.
 *
 * WHY IT LOOKS DIFFERENT FROM CALENDLY, and why that costs nothing:
 *
 *  · No OAuth. WordPress cannot be authorised; the customer installs a snippet
 *    that POSTs to a per-connection URL and signs with a per-connection secret.
 *    `auth: 'api_key'` in the catalog describes exactly that.
 *  · A submission usually means a NEW person. Calendly bookings come from
 *    people who are already leads; a contact form is a lead SOURCE. So Law 2's
 *    "resolve to exactly one Lead" is a find-or-create here, and creating one
 *    emits `lead.created` exactly as the Facebook ingestion path does.
 *  · Forms are discovered, not fetched. CF7 exposes no list API, so the
 *    connector LEARNS a form the first time it sees a submission from it. The
 *    same `enum_remote` control then lists them.
 */

const INTEGRATION_KEY = 'contact_form_7'
const EVENT_KEY = 'form.submitted'
const OPTION_SOURCE = 'forms'

type ConnectionRow = {
  id: number
  agencyId: number
  ownerUserId: number | null
  externalId: string | null
  displayName: string | null
  webhookSecret: string | null
  revokedAt: Date | string | null
}

/** Stable across re-provisioning: the row id — never the site URL, never a key. */
const connectionId = (row: { id: number }) => `${INTEGRATION_KEY}:${row.id}`

const rowIdOf = (id: string): number | null => {
  const [key, raw] = id.split(':')
  if (key !== INTEGRATION_KEY) return null
  const parsed = Number(raw)
  return Number.isInteger(parsed) ? parsed : null
}

/**
 * Health from stored state alone. A connection with no secret cannot verify
 * anything that arrives, so it is `degraded` rather than quietly `ok` — the
 * customer sees דורש טיפול instead of silently receiving nothing.
 */
function healthOf(row: ConnectionRow): Connection['health'] {
  if (row.revokedAt) return 'revoked'
  if (!row.webhookSecret) return 'degraded'
  if (!row.ownerUserId) return 'degraded'
  return 'ok'
}

async function rows(agencyId: number): Promise<ConnectionRow[]> {
  return (await db('automation_connections')
    .select('id', 'agencyId', 'ownerUserId', 'externalId', 'displayName', 'webhookSecret', 'revokedAt')
    .where({ agencyId, integrationKey: INTEGRATION_KEY })
    .orderBy('id')) as ConnectionRow[]
}

// ── The WordPress payload — the only place CF7's own shape is known ────────

type Cf7Payload = {
  /** CF7's numeric form post id. */
  form_id?: string | number
  form_title?: string
  /** Our snippet's per-submission id; falls back to a hash of the body. */
  submission_id?: string
  page_url?: string
  fields?: Record<string, unknown>
}

/**
 * CF7 field names are author-chosen (`your-name`, `שם`, `tel-1`…), so the
 * connector matches on the conventional prefixes CF7's own docs use, then on
 * shape. Anything it cannot classify is left out rather than guessed into the
 * wrong column.
 */
const FIELD_HINTS = {
  email: ['your-email', 'email', 'mail', 'אימייל', 'מייל'],
  phone: ['your-phone', 'your-tel', 'phone', 'tel', 'mobile', 'טלפון', 'נייד'],
  name: ['your-name', 'name', 'fullname', 'full-name', 'שם'],
  message: ['your-message', 'message', 'comments', 'body', 'הודעה', 'תוכן'],
} as const

const text = (v: unknown): string => {
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ')
  if (typeof v === 'number') return String(v)
  return ''
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function pick(fields: Record<string, unknown>, hints: readonly string[]): string {
  const entries = Object.entries(fields)
  for (const hint of hints) {
    const hit = entries.find(([key]) => key.toLowerCase().includes(hint))
    if (hit && text(hit[1])) return text(hit[1])
  }
  return ''
}

/** Last resort for email/phone: the value's own shape, never its label. */
function pickByShape(fields: Record<string, unknown>, test: (v: string) => boolean): string {
  for (const value of Object.values(fields)) {
    const v = text(value)
    if (v && test(v)) return v
  }
  return ''
}

const digitsOf = (raw: string) => raw.replace(/\D/g, '')
const looksLikePhone = (v: string) => digitsOf(v).length >= 9 && digitsOf(v).length <= 15

/** `972XXXXXXXXX`, matching the normalisation the shipped webhooks already use. */
function normalisePhone(raw: string): string | null {
  const digits = digitsOf(raw)
  if (digits.length < 9) return null
  return digits.startsWith('972') ? digits : `972${digits.replace(/^0/, '')}`
}

// ── Source learning ───────────────────────────────────────────────────────

/**
 * Remember a form the first time a submission arrives from it, so the Builder's
 * form picker fills itself. Idempotent; a rename updates the label while the
 * stable id — CF7's form post id — never moves, so a bound automation survives.
 */
async function rememberForm(agencyId: number, connectionRowId: number, formId: string, label: string): Promise<void> {
  await db('automation_sources')
    .insert({
      agencyId,
      connectionRowId,
      externalId: formId,
      label: label || formId,
      subscription: 'subscribed',
    })
    .onConflict(['connectionRowId', 'externalId'])
    .merge({ label: label || formId, subscription: 'subscribed' })
}

// ── Lead resolution (Law 2) ───────────────────────────────────────────────

const submissionSource = (rowId: number, submissionId: string) => `${INTEGRATION_KEY}:${rowId}:${submissionId}`

/**
 * Find-or-create, agency-scoped throughout, in the order that cannot create a
 * duplicate: this exact submission first (a retried webhook must not create a
 * second lead), then phone, then email.
 *
 * A newly created lead emits `lead.created` — the same contract the Facebook
 * ingestion path uses, so a business's "ליד חדש" automations fire for website
 * forms exactly as they do for lead ads.
 */
async function findOrCreateLead(
  agencyId: number,
  row: ConnectionRow,
  mapped: MappedEvent,
  submissionId: string,
): Promise<number | null> {
  const leadSource = submissionSource(row.id, submissionId)

  const bySubmission = await db('clients').select('id').where({ agencyId, leadSource }).first()
  if (bySubmission) return Number(bySubmission.id)

  const phone = mapped.subject.phone ? normalisePhone(mapped.subject.phone) : null
  if (phone) {
    const byPhone = await db('clients').select('id').where({ agencyId, phone }).orderBy('id').first()
    if (byPhone) return Number(byPhone.id)
  }

  const email = (mapped.subject.email ?? '').trim().toLowerCase()
  if (email) {
    const byEmail = await db('clients')
      .select('id')
      .where({ agencyId })
      .whereRaw('lower(email) = ?', [email])
      .orderBy('id')
      .first()
    if (byEmail) return Number(byEmail.id)
  }

  // Nobody matched: this is a new person, which is what a contact form is for.
  if (!row.ownerUserId) return null
  const quota = await getQuotaStatus(agencyId)
  const overQuota = quota.plan === 'free' && quota.limit !== null && quota.used >= quota.limit

  const created = await insertLeadSystem({
    agencyId,
    userId: row.ownerUserId,
    handlerId: row.ownerUserId,
    firstName: text(mapped.fields.leadName) || 'ליד מהאתר',
    idNum: `CF7_${row.id}_${submissionId}`.slice(0, 40),
    leadSource,
    phone,
    email: email || null,
    overQuota,
    lead: true,
  })
  if (!created) {
    // A concurrent delivery of the same submission lost the unique-index race.
    const concurrent = await db('clients').select('id').where({ agencyId, leadSource }).first()
    return concurrent ? Number(concurrent.id) : null
  }

  // Genuinely new lead ⇒ the same trigger a Facebook lead fires. Never throws.
  await emitAutomationEvent({
    trigger: 'lead_created',
    origin: 'webhook',
    agencyId,
    leadId: created.id,
    occurredAt: new Date(),
    leadSource,
  })
  return Number(created.id)
}

/** The origin of a URL, or '' when it is not one. Never throws on junk. */
function originOf(raw: string): string {
  try {
    return new URL(raw).origin.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Which connection a submission belongs to: the one whose registered site is
 * the page's origin. With exactly one live connection and no usable page URL,
 * that one is unambiguous; with several, an unmatched submission is DROPPED
 * rather than attributed to the wrong site.
 */
function matchSite(live: ConnectionRow[], pageUrl: string): ConnectionRow | null {
  const origin = originOf(pageUrl)
  if (origin) {
    const exact = live.find((r) => originOf(r.externalId ?? '') === origin)
    if (exact) return exact
  }
  return live.length === 1 ? live[0] : null
}

// ── The connector ─────────────────────────────────────────────────────────

export const contactForm7Provider: ConnectionProvider = {
  integrationKey: INTEGRATION_KEY,
  capabilities: ['wordpress_form_connected'],

  /**
   * The one thing we cannot do for the customer: put our URL and secret into
   * their WordPress. So we hand them a snippet that already contains both,
   * rather than a specification they have to implement.
   *
   * `wpcf7_mail_sent` is CF7's own post-submission hook, so this needs no
   * plugin and no CF7 configuration — it goes in the theme's functions.php or
   * any snippet plugin, which is a place every WordPress owner already has.
   */
  setup({ webhookUrl, secret }): SetupGuide {
    const secretLine = secret
      ? `$secret = '${secret}';`
      : "$secret = 'הקוד-הסודי-ששמרתם'; // הקוד מוצג פעם אחת בלבד ביצירת החיבור"
    return {
      title: 'חיבור האתר בשלושה צעדים',
      steps: [
        'היכנסו לניהול וורדפרס של האתר.',
        'הוסיפו את קטע הקוד הבא ל-functions.php של ערכת העיצוב, או לתוסף קטעי קוד.',
        'שלחו טופס אחד לבדיקה — הטופס יופיע כאן תוך שניות.',
      ],
      snippet: {
        label: 'קוד לוורדפרס',
        language: 'php',
        code: [
          "add_action('wpcf7_mail_sent', function ($form) {",
          `  $url = '${webhookUrl}';`,
          `  ${secretLine}`,
          '  $submission = WPCF7_Submission::get_instance();',
          '  if (!$submission) { return; }',
          '  $body = wp_json_encode([',
          "    'form_id'       => $form->id(),",
          "    'form_title'    => $form->title(),",
          "    'submission_id' => wp_generate_uuid4(),",
          "    'page_url'      => $submission->get_meta('url'),",
          "    'fields'        => $submission->get_posted_data(),",
          '  ]);',
          '  wp_remote_post($url, [',
          "    'headers' => [",
          "      'Content-Type'         => 'application/json',",
          "      'x-socialcrm-signature' => hash_hmac('sha256', $body, $secret),",
          '    ],',
          "    'body'    => $body,",
          "    'timeout' => 5,",
          '  ]);',
          '});',
        ].join('\n'),
      },
    }
  },

  async listConnections(agencyId) {
    return (await rows(agencyId)).map<Connection>((row) => ({
      id: connectionId(row),
      integrationKey: INTEGRATION_KEY,
      agencyId: row.agencyId,
      displayName: row.displayName || row.externalId || 'אתר וורדפרס',
      health: healthOf(row),
    }))
  },

  async listSources(agencyId, id) {
    const rowId = rowIdOf(id)
    if (rowId == null) return []
    const found = (await db('automation_sources')
      .select('externalId', 'label', 'subscription', 'revokedAt')
      .where({ agencyId, connectionRowId: rowId })
      .orderBy('label')) as {
      externalId: string
      label: string | null
      subscription: Source['subscription']
      revokedAt: Date | null
    }[]
    return found.map<Source>((s) => ({
      id: s.externalId, // CF7's stable form id — never the title
      connectionId: id,
      label: s.label || s.externalId,
      subscription: s.subscription,
      health: s.revokedAt ? 'revoked' : 'ok',
    }))
  },

  async options(agencyId, id, optionSource): Promise<ConnectionOption[]> {
    // One declared option source. An unknown one yields nothing rather than
    // guessing what the caller meant (Law 3).
    if (optionSource !== OPTION_SOURCE) return []
    const sources = await contactForm7Provider.listSources(agencyId, id)
    return sources.map((s) => ({ id: s.id, label: s.label }))
  },

  /**
   * HMAC-SHA256 over the raw body with the connection's own secret, compared in
   * constant time. A missing, malformed or wrong-length signature is a
   * rejection — never a pass. Per-connection, so a leaked secret is contained
   * to one site and revoked by re-provisioning that connection.
   */
  verifyWebhook({ headers, body }) {
    const given = headers['x-socialcrm-signature'] ?? ''
    const secret = headers['x-connection-secret'] ?? ''
    if (!given || !secret) return false
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
    const a = Buffer.from(expected)
    const b = Buffer.from(given)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  },

  /**
   * Provider payload → engine occurrence, with every value translated into the
   * CATALOG field keys `form.submitted` declares. A payload we cannot identify
   * returns null; nothing throws.
   */
  mapEvent(payload) {
    const body = payload as Cf7Payload | null
    if (!body || typeof body !== 'object') return null

    const formId = text(body.form_id)
    if (!formId) return null

    const fields = (body.fields && typeof body.fields === 'object' ? body.fields : {}) as Record<string, unknown>
    const email = pick(fields, FIELD_HINTS.email) || pickByShape(fields, (v) => EMAIL_SHAPE.test(v))
    const phone = pick(fields, FIELD_HINTS.phone) || pickByShape(fields, looksLikePhone)
    const name = pick(fields, FIELD_HINTS.name)
    const message = pick(fields, FIELD_HINTS.message)

    // Law 2 is decided here, before anything is queued: a submission with no
    // way to reach or identify a person is not an occurrence we can act on.
    if (!email && !phone) return null

    // A submission id is preferred; a content hash is the stable fallback, so
    // a retried delivery of the same submission dedups instead of duplicating.
    const submissionId =
      text(body.submission_id) ||
      crypto.createHash('sha256').update(`${formId}|${email}|${phone}|${message}`).digest('hex').slice(0, 32)

    return {
      eventKey: EVENT_KEY,
      occurrenceKey: `form:${formId}:${submissionId}`,
      occurredAt: new Date(),
      fields: {
        formName: text(body.form_title) || formId,
        message,
        pageUrl: text(body.page_url),
        // Carried for lead creation; not a declared catalog field, and the
        // condition evaluator ignores what an event does not declare.
        leadName: name,
        formId,
        submissionId,
      },
      subject: { email: email || null, phone: phone || null },
    }
  },

  /**
   * Law 2 — exactly one Lead, resolved before the engine, plus the one place
   * this connector learns which forms exist.
   *
   * The connection is identified from the SITE the submission came from, so an
   * agency running several WordPress sites keeps them apart. The generic
   * contract passes an agency, not a connection, and this connector does not
   * need it to: a form submission carries its own origin.
   */
  async resolveSubject(agencyId, mapped: MappedEvent) {
    const formId = text(mapped.fields.formId)
    const submissionId = text(mapped.fields.submissionId)
    if (!formId || !submissionId) return null

    const live = (await rows(agencyId)).filter((r) => !r.revokedAt)
    const row = matchSite(live, text(mapped.fields.pageUrl))
    if (!row) return null

    await rememberForm(agencyId, row.id, formId, text(mapped.fields.formName))
    return findOrCreateLead(agencyId, row, mapped, submissionId)
  },
}
