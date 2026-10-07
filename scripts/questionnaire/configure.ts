/**
 * Staff configuration for the WhatsApp questionnaire.
 *
 * The one supported way to point a business at a questionnaire, and to take it
 * back off one. It targets an AGENCY ID — never an email, a name or anything
 * else that could match the wrong tenant.
 *
 *   tsx scripts/questionnaire/configure.ts --agency 123 --file <path> [--dry-run]
 *   tsx scripts/questionnaire/configure.ts --agency 123 --file <path> --publish [--discard-draft]
 *   tsx scripts/questionnaire/configure.ts --agency 123 --file <path> --enable  [--discard-draft]
 *   tsx scripts/questionnaire/configure.ts --agency 123 --disable
 *   tsx scripts/questionnaire/configure.ts --agency 123 --show
 *
 * --dry-run is the default: it validates, prints every message the customer
 * would receive, and writes nothing. Nothing about this script sends WhatsApp
 * messages or touches a live conversation.
 *
 * ONE PUBLICATION PATH. --publish and --enable never write the questionnaire
 * themselves: they call the Questionnaire Builder's publish service, which
 * records an immutable revision and updates the live copy in one transaction
 * (lib/inbox/autoresponse/questionnaire/builder/publish.ts). It refuses while
 * the owner has a Builder draft open, unless --discard-draft says so.
 *
 * PUBLISH IS NOT ACTIVATION. --publish leaves routing exactly as it is.
 * --enable publishes and THEN, as a separate, explicit step, routes the agency
 * to the questionnaire (responder = 'questionnaire'), as this script always
 * has. --disable routes it back to the agent and deletes nothing.
 *
 * ENABLING HERE IS NOT ENOUGH, deliberately. The questionnaire also needs
 * WA_QUESTIONNAIRE_ENABLED=1 and the agency on WA_QUESTIONNAIRE_AGENCY_IDS, plus
 * the owner's own master switch. Two hands on the lever, one of them the
 * customer's.
 */
import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/config/db'
import { parseQuestionnaireDefinition, type QuestionnaireDefinition } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { MAX_RENDERED_MESSAGE_CHARS } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { renderOpening, renderQuestion, renderSummary } from '@/lib/inbox/autoresponse/questionnaire/render'
import { nextStepAfter } from '@/lib/inbox/autoresponse/questionnaire/definition'
import { publishDefinition } from '@/lib/inbox/autoresponse/questionnaire/builder/publish'
import { getDraft, getLatestPublished, listPublished } from '@/db/questionnaireRevisions'

type Args = {
  agencyId: number
  file: string | null
  mode: 'dry-run' | 'publish' | 'enable' | 'disable' | 'show'
  discardDraft: boolean
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null
  }
  const agencyId = Number(get('--agency'))
  if (!Number.isFinite(agencyId) || agencyId <= 0) {
    throw new Error('--agency <id> is required')
  }
  const mode: Args['mode'] = argv.includes('--disable')
    ? 'disable'
    : argv.includes('--show')
      ? 'show'
      : argv.includes('--enable')
        ? 'enable'
        : argv.includes('--publish')
          ? 'publish'
          : 'dry-run'
  return { agencyId, file: get('--file'), mode, discardDraft: argv.includes('--discard-draft') }
}

/** Every message this definition can produce, in order. */
function renderAll(definition: QuestionnaireDefinition): string[] {
  const out: string[] = []
  const first = nextStepAfter(definition, {}, null)
  if (first) out.push(renderOpening(definition, first))
  for (const step of definition.steps) {
    if (first && step.id === first.id) continue
    out.push(renderQuestion(step))
  }
  out.push(definition.closing)
  for (const variant of definition.closingVariants ?? []) {
    out.push(`[closing when ${variant.when.step} is ${variant.when.anyOf.join(' or ')}]\n${variant.text}`)
  }
  out.push(definition.handoff)
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const agency = await db('agencies').where({ id: args.agencyId }).first('id', 'name', 'autoResponseEnabled')
  if (!agency) throw new Error(`agency ${args.agencyId} does not exist`)
  const channel = await db('auto_response_settings')
    .where({ agencyId: args.agencyId, channel: 'whatsapp' })
    .first('enabled', 'responder', 'questionnaire', 'mode', 'replyMode')

  console.log(`agency ${agency.id} (${agency.name})`)
  console.log(`  master switch (agencies.autoResponseEnabled): ${agency.autoResponseEnabled === true}`)
  console.log(`  whatsapp channel enabled: ${channel?.enabled === true}`)
  console.log(`  responder: ${channel?.responder ?? 'agent'}`)
  console.log(`  env gate: WA_QUESTIONNAIRE_ENABLED=${process.env.WA_QUESTIONNAIRE_ENABLED ?? '(unset)'} ` +
    `WA_QUESTIONNAIRE_AGENCY_IDS=${process.env.WA_QUESTIONNAIRE_AGENCY_IDS ?? '(unset)'}`)

  const [latest, draft] = await Promise.all([getLatestPublished(args.agencyId), getDraft(args.agencyId)])
  console.log(`  published revisions: newest ${latest?.revision ?? 'none'}; owner draft open: ${draft ? `yes (version ${draft.draftVersion})` : 'no'}`)

  if (args.mode === 'show') {
    for (const r of await listPublished(args.agencyId)) {
      console.log(`    revision ${r.revision} · ${r.source} · ${r.publishedAt}${r.publishedBy ? ` · user ${r.publishedBy}` : ''}`)
    }
    const parsed = parseQuestionnaireDefinition(channel?.questionnaire ?? null)
    if (parsed.ok === false) {
      console.log('  stored questionnaire: none (or invalid)')
      parsed.errors.forEach((e) => console.log(`    ${e}`))
      return
    }
    console.log(`  stored questionnaire: revision ${parsed.definition.revision}, ${parsed.definition.steps.length} steps`)
    renderAll(parsed.definition).forEach((m) => console.log(`\n---\n${m}`))
    return
  }

  if (args.mode === 'disable') {
    // Back to the agent for NEW conversations. Any live session is wound down
    // by the worker itself on its next turn: it hands the conversation to a
    // person with whatever was collected, and never to the AI.
    await db('auto_response_settings')
      .where({ agencyId: args.agencyId, channel: 'whatsapp' })
      .update({ responder: 'agent', updatedAt: db.fn.now() })
    const live = await db('questionnaire_sessions')
      .where({ agencyId: args.agencyId, status: 'active' })
      .count<{ count: string }[]>('id as count')
    console.log(`\nDISABLED. responder = 'agent'.`)
    console.log(`  live sessions that will be handed to a rep on their next turn: ${live[0]?.count ?? 0}`)
    return
  }

  if (!args.file) throw new Error('--file <path-to-definition.json> is required')
  const raw = fs.readFileSync(path.resolve(args.file), 'utf8')
  const parsed = parseQuestionnaireDefinition(raw)
  if (parsed.ok === false) {
    console.error('\nINVALID definition. Nothing was written:')
    parsed.errors.forEach((e) => console.error(`  ${e}`))
    process.exitCode = 1
    return
  }
  const definition = parsed.definition

  const messages = renderAll(definition)
  const tooLong = messages.filter((m) => m.length > MAX_RENDERED_MESSAGE_CHARS)
  console.log(`\n${definition.steps.length} steps, revision ${definition.revision}. Messages the customer receives:`)
  messages.forEach((m) => console.log(`\n---\n${m}`))
  console.log(`\n---\nThe rep's summary (with every question answered):`)
  console.log(
    renderSummary(
      definition,
      Object.fromEntries(
        definition.steps.map((s) => [s.id, s.type === 'choice' ? [s.options[0].id] : ['(תשובת הפונה)']]),
      ),
      { complete: true },
    ),
  )
  if (tooLong.length) {
    console.error(`\n${tooLong.length} message(s) exceed ${MAX_RENDERED_MESSAGE_CHARS} characters. Nothing written.`)
    process.exitCode = 1
    return
  }

  if (args.mode === 'dry-run') {
    console.log(`\nDRY RUN. Nothing was written. --publish would create revision ${(latest?.revision ?? 0) + 1}; --enable would also route the agency to it.`)
    return
  }

  if (args.mode === 'enable' && !channel) {
    // Checked BEFORE publishing so --enable never stops half way.
    throw new Error(
      `agency ${args.agencyId} has no auto_response_settings row for whatsapp. ` +
        'The owner must save Auto Response settings once before a questionnaire can be routed. Nothing written.',
    )
  }

  const published = await publishDefinition({ agencyId: args.agencyId, definition, discardDraft: args.discardDraft })
  if (published.ok === false) {
    console.error(`\nNOT PUBLISHED (${published.reason}). Nothing was written.`)
    if (published.reason === 'owner_draft_exists') console.error('  The owner has a Builder draft open. Re-run with --discard-draft to replace it deliberately.')
    process.exitCode = 1
    return
  }
  console.log(`\nPUBLISHED revision ${published.revision} (routing unchanged).`)

  if (args.mode === 'enable') {
    await db('auto_response_settings')
      .where({ agencyId: args.agencyId, channel: 'whatsapp' })
      .update({ responder: 'questionnaire', updatedAt: db.fn.now() })
    console.log('ROUTED: responder = questionnaire.')
  }

  // Read back what the runtime will actually read.
  const after = await db('auto_response_settings')
    .where({ agencyId: args.agencyId, channel: 'whatsapp' })
    .first('responder', 'enabled', 'questionnaire')
  const live = parseQuestionnaireDefinition(after?.questionnaire ?? null)
  console.log(
    after
      ? `  live copy: revision ${live.ok ? live.definition.revision : 'invalid'} · responder ${after.responder} · channel ${after.enabled ? 'on' : 'off'}`
      : '  live copy: none (no settings row; routing is off until the agency is activated)',
  )
  if (args.mode === 'enable') {
    console.log('  Still required before a customer sees anything:')
    console.log('    · WA_QUESTIONNAIRE_ENABLED=1')
    console.log(`    · WA_QUESTIONNAIRE_AGENCY_IDS includes ${args.agencyId}`)
    console.log("    · agencies.autoResponseEnabled = true (the owner's switch)")
    console.log('    · auto_response_settings.enabled = true for whatsapp')
  }
}

main()
  .then(() => db.destroy())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
    await db.destroy()
  })
