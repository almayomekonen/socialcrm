import { asSchema, type FlexibleSchema } from 'ai'

/**
 * UTF-8 sizes of the request parts the SDK serialises from our definitions —
 * a structured-output schema and tool definitions — for the shadow budget
 * estimate. Async because a schema's JSON form may be lazy. Never throws:
 * null means "could not be measured", which the estimate labels.
 */

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8')

export async function schemaBytes(schema: FlexibleSchema<unknown> | undefined): Promise<number | null> {
  if (!schema) return 0
  try {
    return bytes(await asSchema(schema).jsonSchema)
  } catch {
    return null
  }
}

type ToolLike = { description?: string; inputSchema?: FlexibleSchema<unknown>; type?: string; id?: string; args?: unknown }

/** Name + description + input schema per function tool; id + args for a provider-defined tool. */
export async function toolDefinitionBytes(tools: Record<string, unknown> | undefined): Promise<number | null> {
  let total = 0
  for (const [name, raw] of Object.entries(tools ?? {})) {
    const t = raw as ToolLike
    if (t.type === 'provider') {
      total += bytes({ name, id: t.id, args: t.args ?? {} })
      continue
    }
    const s = await schemaBytes(t.inputSchema)
    if (s == null) return null
    total += bytes({ name, description: t.description ?? '' }) + s
  }
  return total
}

/** Everything definitional re-sent with each request: tools and the output schema. null if any part is unmeasurable. */
export async function definitionBytes(defs: {
  tools?: Record<string, unknown>
  schema?: FlexibleSchema<unknown>
}): Promise<number | null> {
  const [t, s] = await Promise.all([toolDefinitionBytes(defs.tools), schemaBytes(defs.schema)])
  return t == null || s == null ? null : t + s
}
