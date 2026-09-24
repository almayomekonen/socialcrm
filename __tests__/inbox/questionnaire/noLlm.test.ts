import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * THE PROMISE: a questionnaire conversation costs nothing in model calls.
 *
 * Behavioural tests can show that no model was called in the cases they
 * exercise. They cannot show that none will be called in a case nobody thought
 * of, or after a future edit adds "just one" classifier. This reads the source
 * instead, in the spirit of `agentSendGuardCoverage` and `agentPreviewIsolation`:
 * the questionnaire tree may not IMPORT the ability to call a model, so it
 * cannot acquire one by accident.
 *
 * If a legitimate need ever arises, this test is the conversation that has to
 * happen first.
 */

const DIR = path.join(process.cwd(), 'lib/inbox/autoresponse/questionnaire')

/** Every way this codebase reaches a language model. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/@\/lib\/ai\//, 'the AI router and its gate'],
  [/runStructured|runText\b/, 'a model call'],
  [/from '\.\.\/qualify'|from '\.\/qualify'/, 'the qualify generator'],
  [/generateQualifyTurn|generateAcknowledgement/, 'a generation entry point'],
  [/conversationSummary|summariseConversation/, 'the LLM rolling summary'],
  [/shadowIngest|shadowCognition|shadowReasonAndDecide/, 'the shadow cognition pipeline'],
  [/qualifyPrompt|QUALIFY_SYSTEM_PROMPT/, 'a model prompt'],
  [/anthropic|openai|gemini/i, 'a model provider'],
]

function sources(): string[] {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.ts'))
}

describe('the questionnaire cannot reach a model', () => {
  it('has files to check', () => {
    expect(sources().length).toBeGreaterThan(4)
  })

  for (const [pattern, what] of FORBIDDEN) {
    it(`never imports ${what}`, () => {
      const offenders: string[] = []
      for (const file of sources()) {
        const src = fs.readFileSync(path.join(DIR, file), 'utf8')
        // Ignore the prose: a comment explaining why we do NOT call a model
        // must not fail the test that proves we do not.
        const code = src
          .split('\n')
          .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
          .join('\n')
        if (pattern.test(code)) offenders.push(file)
      }
      expect(offenders, `${offenders.join(', ')} reaches ${what}`).toEqual([])
    })
  }

  it('imports the deterministic detectors it DOES share with the agent', () => {
    // One vocabulary for "stop" and "let me talk to a person" across the
    // product. Both are pure regex, which is why sharing them is safe — and the
    // opt-out list was moved OUT of the generator module so taking it does not
    // drag the AI router along with it.
    const parse = fs.readFileSync(path.join(DIR, 'parseAnswer.ts'), 'utf8')
    expect(parse).toContain("import { detectOptOut } from '../optOutDetect'")
    expect(parse).toContain('isExplicitPersonRequest')
  })

  /**
   * The direct-import checks above can be satisfied by importing something that
   * itself imports a model. This follows every edge instead, so the claim is
   * about the module graph the runtime actually loads.
   */
  it('cannot reach a model through any chain of imports', () => {
    const resolve = (from: string, spec: string): string | null => {
      const base = spec.startsWith('@/')
        ? path.join(process.cwd(), spec.slice(2))
        : spec.startsWith('.')
          ? path.resolve(path.dirname(from), spec)
          : null
      if (!base) return null // a package, not our source
      for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) return candidate
      }
      return null
    }

    const seen = new Set<string>()
    const offenders: string[] = []
    const visit = (file: string, trail: string[]) => {
      if (seen.has(file)) return
      seen.add(file)
      const rel = path.relative(process.cwd(), file)
      if (rel.startsWith('lib/ai/')) {
        offenders.push([...trail, rel].join(' → '))
        return
      }
      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(/(?:from|import)\s+'([^']+)'/g)) {
        const target = resolve(file, m[1])
        if (target) visit(target, [...trail, rel])
      }
    }
    for (const file of sources()) visit(path.join(DIR, file), [])

    expect(offenders, offenders.join('\n')).toEqual([])
    expect(seen.size, 'the graph walk found nothing, so it proves nothing').toBeGreaterThan(10)
  })
})

describe('the analysis job is suppressed at every site that creates one', () => {
  const callers = [
    'lib/inbox/ingestWhatsappInbound.ts',
    'lib/inbox/persistOutboundWhatsapp.ts',
    'actions/whatsapp/promoteConversationToLead.ts',
  ]

  it('is the complete set of enqueue sites', () => {
    // If a fourth appears, it needs the same guard, and this list is how the
    // build says so.
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts') && !full.includes('__tests__')) {
          const src = fs.readFileSync(full, 'utf8')
          if (/await enqueueConversationAnalysis\(/.test(src)) {
            hits.push(path.relative(process.cwd(), full))
          }
        }
      }
    }
    for (const root of ['lib', 'actions', 'app', 'db']) walk(path.join(process.cwd(), root))
    expect(hits.sort()).toEqual([...callers].sort())
  })

  for (const file of callers) {
    it(`${file} checks first`, () => {
      const src = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
      expect(src).toContain('isQuestionnaireConversation')
    })
  }
})
