import type { Messages } from '../../translate'

export const language: Messages['language'] = {
  pageTitle: 'Interface language',
  intro:
    'The language of menus, buttons and settings. Names, messages and lead content are never translated and stay exactly as they were written.',
  personalTitle: 'My language',
  personalHelp: 'Applies only to you, on every device you sign in from.',
  personalLabel: 'Your interface language',
  useAgencyDefault: 'Business default ({language})',
  effectiveFromUser: 'Showing now: {language}, your personal choice',
  effectiveFromAgency: 'Showing now: {language}, the business default',
  effectiveFromDefault: 'Showing now: {language}, the system default',
  savePersonal: 'Save language',
  savedPersonal: 'Language updated',
  agencyTitle: 'Business default language',
  agencyHelp:
    'Reps who have not chosen a personal language see this one. A rep who chose a personal language keeps seeing their choice.',
  agencyLabel: 'Default language',
  agencyChangePreview: 'After saving, reps without a personal language will see the interface in {to} (instead of {from}).',
  saveAgency: 'Update default language',
  savedAgency: 'Business default language updated',
  saveError: 'The language could not be saved. Please try again.',
}
