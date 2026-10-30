import type { Surface } from './surfaces'
import { EMPTY_QUESTIONNAIRE, QUESTIONNAIRE, QUESTIONNAIRE_DEFAULTS, draftOf } from './questionnaireEnv'
import { EXPIRED, questionnairePage, questionnaireShell, withQuestionnaireEnv } from './questionnaireHarness'
import { withAdminEnv } from './adminHarness'
import { LIST_VIEW, content } from './questionnaireVerbatim'

/**
 * Leak-gate registrations for the questionnaire builder (Phase E5c, desktop):
 * /settings/questionnaire in each page state. Spread into SURFACES
 * (surfaces.tsx); rendering relies on the mocks in leakGate.test.tsx
 * (switching factories: leakGateQuestionnaireMocks.ts). The Flow map (loaded
 * lazily, not part of the server render), the dialogs, the version history and
 * the test chat are opened and scanned in questionnaireLocales*.test.tsx.
 *
 * Allowed: the questionnaire itself (verbatim-content, questionnaireVerbatim.ts).
 */
type Overrides = Parameters<typeof withQuestionnaireEnv>[0]
const live = (routedToQuestionnaire: boolean, channelEnabled = true, masterEnabled = true) => ({ hasSettings: true, routedToQuestionnaire, channelEnabled, masterEnabled })
const state = (patch: Partial<typeof QUESTIONNAIRE_DEFAULTS.state>) => ({ ...structuredClone(QUESTIONNAIRE_DEFAULTS.state), ...patch })

/** The (admin_settings) layout reads the session through the admin fixtures; the page through the questionnaire ones. */
const page = (overrides: Overrides = {}, ent?: typeof EXPIRED) => async (locale: Parameters<Surface['render']>[0]) =>
  questionnaireShell(locale, await withAdminEnv({}, () => withQuestionnaireEnv(overrides, () => questionnairePage())), ent)

const ROUTE = '/settings/questionnaire'

export const QUESTIONNAIRE_SURFACES: Surface[] = [
  { name: 'questionnaire — list view, published and answering', route: ROUTE, render: page({ flow: false }), allowed: LIST_VIEW },
  {
    name: 'questionnaire — list view, natural answers, auto-response off',
    route: ROUTE,
    render: page({ flow: false, allowAll: true, state: state({ live: live(true, true, false) }) }),
    allowed: LIST_VIEW,
  },
  { name: 'questionnaire — Flow view (header and view switch)', route: ROUTE, render: page(), allowed: [] },
  { name: 'questionnaire — no draft yet (opening it)', route: ROUTE, render: page({ state: state({ draft: null }) }), allowed: [] },
  {
    name: 'questionnaire — never published, not switched on',
    route: ROUTE,
    render: page({ flow: false, state: state({ draft: draftOf(QUESTIONNAIRE, 9, 1, null), published: null, live: live(false, false, false) }) }),
    allowed: LIST_VIEW,
  },
  { name: 'questionnaire — published, not routed', route: ROUTE, render: page({ state: state({ live: live(false) }) }), allowed: [] },
  {
    name: 'questionnaire — list view without questions',
    route: ROUTE,
    render: page({ flow: false, state: state({ draft: draftOf(EMPTY_QUESTIONNAIRE) }) }),
    allowed: content(QUESTIONNAIRE.opening, QUESTIONNAIRE.endings.standard),
  },
  { name: 'questionnaire — subscription expired', route: ROUTE, render: page({ hasAccess: false }, EXPIRED), allowed: [] },
]
