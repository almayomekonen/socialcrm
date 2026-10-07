# Questionnaire Builder PR2: Conversation Editor (implementation plan)

Builds on PR1 (`docs/questionnaire-builder-pr1.md`). No runtime change, no
migration, and no second engine.

## Entry point and gating
- Route: `/settings/questionnaire` (admin settings group).
- It is gated by the PR1 rules, `requireProductAccess` + `isAdmin` +
  `QUESTIONNAIRE_BUILDER_AGENCY_IDS`, at three places:
  1. the server page, which calls `notFound()` when the agency is not allowed;
  2. the desktop settings nav item "שאלון וואטסאפ", under מענה אוטומטי;
  3. the mobile "עוד" row.
- An agency outside the rollout sees no nav item, no row and no link. The
  מענה אוטומטי notice links to the Builder only for agencies in the rollout.

## Parity: one implementation
The editor never formats a WhatsApp message itself. The live preview runs the
browser-safe production modules directly:

    local model → toDefinition (convert.ts) → describeQuestionnaire (view.ts → render.ts) → finalizeCustomerFacingText

Publish readiness is computed live with the same `checkDefinitionForPublish`
that the server runs. The simulator calls the PR1 `simulate` action, which uses
the production decision code. That whole module graph imports only zod, and a
test proves it.

## Domain additions (pure, tested)
- **`ref` on new questions and options.** The browser may reference a
  brand-new option or question, for example "אחר" plus its follow-up, before
  the server mints an id:
  - `assignIds` resolves refs to fresh server ids and rewrites every condition
    that uses them;
  - `saveDraft` returns the mapping it assigned;
  - a ref never becomes an id, so the PR1 rule "a client cannot mint ids" holds.
- **`editorOps.ts`.** Every editor mutation lives here as a pure function: add,
  move, delete and retype a question; options; the "אחר" follow-up;
  conditions; endings.
- **`editorView.ts`.** The live preview, live issues per card, and the
  sentence "השאלה תופיע כאשר…".
- **Skeleton.** A clean opening, so an agency name's dash never leaks into it,
  plus a first question ("במה נוכל לעזור?").
- **Simulator explanation.** A text answer is reported as `text`, never as
  `optionIds`.
- **`listRevisions`.** Adds the publisher's name when it is known.

## UI (components/settings/questionnaire/)
- **Desktop layout.** Two panes: the editor on the right (RTL main) and a
  sticky WhatsApp preview on the left. The preview pane switches to the
  simulator ("בדיקת השאלון").
- **Saving.**
  - Autosave is debounced, and saves are serialized.
  - It shows "שומר…" / "נשמר".
  - A version conflict stops autosave and shows a banner. The editor never
    overwrites another tab's work.
  - The browser warns before the page closes with unsaved edits.
- **Publish.** A confirmation names the revision number and explains pinning in
  one line. Issues returned by the server are attached to their cards.
- **History.** A list of revisions, with "יצירת טיוטה מגרסה זו". It goes through
  the PR1 `openDraft({fromRevision})`, discarding the current draft only after
  an explicit confirmation.
- **Mobile** (phones and tablets, server-gated). Shows status (live version,
  draft, routing) and the simulator. Editing stays desktop-only.

## Out of scope
The following are deliberately left out of PR2:
- drag-and-drop;
- AND/OR conditions (the model already keeps a list, so the UI can grow into
  them);
- routing or enable toggles (there is no product path for them yet);
- AI generation;
- templates.

## Implementation notes (as built)
- **"מיקום / מקום" is a Builder preset, not a runtime check.** It runs as
  `validate: 'meaningful'`, sets "not decided" on, and fills in location wording
  for the not-understood message. A loaded question shows as מיקום when that
  message is about a location.
- **Restore** is discard (with confirmation) followed by
  `openDraft({fromRevision})`. Publishing the result creates the next revision.
  A backfilled revision is labelled as "the version that was live when history
  began", never with a publish date that would be invented.
- **Two new issue rules.**
  - `condition_needs_answer`: a condition with no answer ticked.
  - Two blank options no longer also report "the same name twice".
- **Layout.** Two panes from 1000px. Below 1000px the editor is not offered (a
  stated handoff) and the simulator still is. Phones (mobile workspace) get
  QuestionnaireMobile on the server.
