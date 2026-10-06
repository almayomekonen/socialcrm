/**
 * Staff configuration for the WhatsApp questionnaire.
 *
 * The one supported way to point a business at a questionnaire, and to take it
 * back off one. It targets an AGENCY ID — never an email, a name or anything
 * else that could match the wrong tenant.
 *
 *   pnpm mig questionnaire/configure.ts -- --agency 123 --file <path> --dry-run
 *   pnpm mig questionnaire/configure.ts -- --agency 123 --file <path> --enable
 *   pnpm mig questionnaire/configure.ts -- --agency 123 --disable
 *   pnpm mig questionnaire/configure.ts -- --agency 123 --show
 *
 * --dry-run is the default: it validates, prints every message the customer
 * would receive, and writes nothing. Nothing about this script sends WhatsApp
 * messages or touches a live conversation.
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

type Args = {
  agencyId: number
  file: string | null
  mode: 'dry-run' | 'enable' | 'disable' | 'show'
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
        : 'dry-run'
  return { agencyId, file: get('--file'), mode }
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

  if (args.mode === 'show') {
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
    console.log('\nDRY RUN. Nothing was written. Re-run with --enable to store this.')
    return
  }

  await db.transaction(async (trx) => {
    const existing = await trx('auto_response_settings')
      .where({ agencyId: args.agencyId, channel: 'whatsapp' })
      .first('agencyId')
    if (!existing) {
      throw new Error(
        `agency ${args.agencyId} has no auto_response_settings row for whatsapp. ` +
          'The owner must save Auto Response settings once before a questionnaire can be attached.',
      )
    }
    await trx('auto_response_settings')
      .where({ agencyId: args.agencyId, channel: 'whatsapp' })
      .update({
        questionnaire: JSON.stringify(definition),
        responder: 'questionnaire',
        updatedAt: trx.fn.now(),
      })
  })

  console.log('\nSTORED. responder = questionnaire.')
  console.log('  Still required before a customer sees anything:')
  console.log('    · WA_QUESTIONNAIRE_ENABLED=1')
  console.log(`    · WA_QUESTIONNAIRE_AGENCY_IDS includes ${args.agencyId}`)
  console.log('    · agencies.autoResponseEnabled = true (the owner\'s switch)')
  console.log('    · auto_response_settings.enabled = true for whatsapp')
}

main()
  .then(() => db.destroy())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
    await db.destroy()
  })
