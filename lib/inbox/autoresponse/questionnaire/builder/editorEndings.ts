/**
 * "סיום שונה לפי תשובה": custom endings, checked top to bottom, the first one
 * that matches is sent (closing.ts). Order is meaning here, so it is editable.
 */
import type { BuilderEnding, BuilderQuestionnaire } from './model'
import type { Condition } from './editorBase'

function withCustom(m: BuilderQuestionnaire, custom: BuilderEnding[]): BuilderQuestionnaire {
  return { ...m, endings: { ...m.endings, custom } }
}

/** A new custom ending starts from the standard one: most differ by one line (a link). */
export function addEnding(m: BuilderQuestionnaire, condition: Condition): BuilderQuestionnaire {
  const ending: BuilderEnding = { sentWhen: { mode: 'all', conditions: [condition] }, message: m.endings.standard }
  return withCustom(m, [...m.endings.custom, ending])
}

export function updateEnding(
  m: BuilderQuestionnaire,
  index: number,
  patch: { message?: string; condition?: Condition },
): BuilderQuestionnaire {
  return withCustom(
    m,
    m.endings.custom.map((e, i) =>
      i !== index
        ? e
        : {
            message: patch.message ?? e.message,
            sentWhen: patch.condition ? { mode: 'all' as const, conditions: [patch.condition] } : e.sentWhen,
          },
    ),
  )
}

export function removeEnding(m: BuilderQuestionnaire, index: number): BuilderQuestionnaire {
  return withCustom(
    m,
    m.endings.custom.filter((_, i) => i !== index),
  )
}

export function moveEnding(m: BuilderQuestionnaire, index: number, by: -1 | 1): BuilderQuestionnaire {
  const to = index + by
  if (index < 0 || to < 0 || to >= m.endings.custom.length) return m
  const custom = [...m.endings.custom]
  ;[custom[index], custom[to]] = [custom[to], custom[index]]
  return withCustom(m, custom)
}
