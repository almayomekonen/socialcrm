/**
 * UI-layer source files ALLOWED to contain Hebrew literals (outside comments), recorded in Phase F6 after a
 * file-by-file review. `hebrewSource.test.ts` fails when any other file under components/, modules/, app/ or hooks/
 * gains a Hebrew literal, and when a listed file no longer has one (shrink the list).
 *
 * Reasons:
 *  - out-of-scope    AI (owner order), Copilot, AI configuration, or marketing-only components under components/ui
 *  - stored-value    a stored Hebrew value / data key that logic compares or a display map is keyed by (never shown raw
 *                    outside Hebrew; stored data never changes)
 *  - hebrew-source   the Hebrew wording of a registry, header table or he-branch that is worded by key / code outside
 *                    Hebrew (pinned by a baseline or copy-pin test), or a Hebrew server sentence matched at render
 *  - hebrew-default  a default prop used only by Hebrew callers; translated callers pass their own
 *  - server-text     server code that creates Hebrew data (placeholder names) or returns a Hebrew `detail` next to a
 *                    code the client words by code
 *
 * Out of the guard on purpose: lib/, actions/, db/, types/ (server producers keep Hebrew defaults for the MCP, agent,
 * mobile API, e-mails and notification emitters), the catalogs, and whole out-of-scope trees (OUT_OF_SCOPE_PREFIXES).
 */

export type HebrewSourceReason = 'out-of-scope' | 'stored-value' | 'hebrew-source' | 'hebrew-default' | 'server-text'

export const GUARDED_ROOTS = ['components', 'modules', 'app', 'hooks']

export const OUT_OF_SCOPE_PREFIXES = [
  'components/marketing/',
  'components/lumen/',
  'components/seo/',
  'components/admin/',
  'components/copilot/',
  'components/agent/',
  'components/ai/',
  'app/(marketing)/',
  'app/admin/',
  'app/api/',
]

export const HEBREW_SOURCE_FILES: Record<string, HebrewSourceReason> = {
  'app/(app)/agent/page.tsx': 'out-of-scope',
  'components/education/ShowMeButton.tsx': 'out-of-scope',
  'components/settings/autoResponse/AgentPreview.tsx': 'out-of-scope',
  'components/settings/autoResponse/AutoResponseReplyStyle.tsx': 'out-of-scope',
  'components/ui/crm-comparison-table.tsx': 'out-of-scope',
  'components/ui/faq-tabs.tsx': 'out-of-scope',
  'components/ui/feature-carousel.tsx': 'out-of-scope',
  'components/ui/footer-column.tsx': 'out-of-scope',
  'components/ui/hero/ChannelBadges.tsx': 'out-of-scope',
  'components/ui/hero/HeroContent.tsx': 'out-of-scope',
  'components/ui/hero/HeroScene.tsx': 'out-of-scope',
  'components/ui/hero/scenes/DealWonCard.tsx': 'out-of-scope',
  'components/ui/how-it-works.tsx': 'out-of-scope',
  'components/ui/pricing-card.tsx': 'out-of-scope',
  'components/ui/radial-orbital-timeline.tsx': 'out-of-scope',
  'components/ui/stagger-testimonials.tsx': 'out-of-scope',
  'modules/settings/mobile/AutoResponseMobile.tsx': 'out-of-scope',
  'app/(app)/promotion/[id]/page.tsx': 'stored-value',
  'components/clientPage/ClientHeader.tsx': 'stored-value',
  'components/clients/clientForm.tsx': 'stored-value',
  'components/dashboard/DashboardSummary.tsx': 'stored-value',
  'components/filter/FilterBtn.tsx': 'stored-value',
  'components/filter/SelectDateRange.tsx': 'stored-value',
  'components/filter/formatFilter.ts': 'stored-value',
  'components/filter/index.tsx': 'stored-value',
  'components/promo/PromoTable.tsx': 'stored-value',
  'components/promo/SelectFilterUserPromo.tsx': 'stored-value',
  'components/promo/UserPromo.tsx': 'stored-value',
  'components/promo/funcs.ts': 'stored-value',
  'components/quotes/QuoteComposer.tsx': 'stored-value',
  'components/sales/saleForm/ProductFields.tsx': 'stored-value',
  'components/sales/saleForm/SaleDetailsFields.tsx': 'stored-value',
  'components/sales/saleForm/SaleForm.tsx': 'stored-value',
  'components/sales/saleForm/funcs/calcCmsn.ts': 'stored-value',
  'components/sales/salesTable/SalesTable.tsx': 'stored-value',
  'components/sales/salesTable/SalesTableDialogs.tsx': 'stored-value',
  'components/sales/salesTable/SalesTableToolbar.tsx': 'stored-value',
  'components/settings/AiConnections.tsx': 'stored-value',
  'components/settings/automations/AutomationTemplateSection.tsx': 'stored-value',
  'components/settings/questionnaire/TextAnswerSettings.tsx': 'stored-value',
  'components/settings/questionnaire/answerCheck.ts': 'stored-value',
  'components/settings/templates/templateCopy.ts': 'stored-value',
  'components/sumSales/FilterChips.tsx': 'stored-value',
  'components/sumSales/GeneralTable.tsx': 'stored-value',
  'components/sumSales/MeshuklalSchumPie.tsx': 'stored-value',
  'components/sumSales/SumSalesPie.tsx': 'stored-value',
  'components/sumSales/reportColumns.ts': 'stored-value',
  'components/tasks/SelectTasksStatus.tsx': 'stored-value',
  'modules/leads/mobile/LeadCardMobile.tsx': 'stored-value',
  'modules/leads/mobile/LeadFormMobile.tsx': 'stored-value',
  'modules/leads/mobile/leadFormOptions.ts': 'stored-value',
  'modules/leads/mobile/leadProvenanceModel.ts': 'stored-value',
  'modules/today/mobile/reasonTone.ts': 'stored-value',
  'app/(auth)/auth/page.tsx': 'hebrew-source',
  'components/agencies/AddAgencyForm.tsx': 'hebrew-source',
  'components/agntsAndGrps/UsersTable.tsx': 'hebrew-source',
  'components/agntsAndGrps/adminLabels.ts': 'hebrew-source',
  'components/auth/Login.tsx': 'hebrew-source',
  'components/auth/LoginMagicLink.tsx': 'hebrew-source',
  'components/clients/hooks/leadStatusRequest.ts': 'hebrew-source',
  'components/files/ClientFilesTable.tsx': 'hebrew-source',
  'components/files/FilesTable.tsx': 'hebrew-source',
  'components/invitations/InvitationsTable.tsx': 'hebrew-source',
  'components/mobile/MobileTabBar.tsx': 'hebrew-source',
  'components/mobile/moreDestinations.ts': 'hebrew-source',
  'components/quotes/QuoteComposerTotals.tsx': 'hebrew-source',
  'components/quotes/QuoteTemplatesSettings.tsx': 'hebrew-source',
  'components/quotes/templateCopy.ts': 'hebrew-source',
  'components/sales/salesTable/GroupAction.tsx': 'hebrew-source',
  'components/sales/salesTable/funcs.tsx': 'hebrew-source',
  'components/sales/salesTable/saleHeaders.tsx': 'hebrew-source',
  'components/settings/automations/sheetOptions.ts': 'hebrew-source',
  'components/settings/connections/copy.ts': 'hebrew-source',
  'components/settings/integrations/catalog.ts': 'hebrew-source',
  'components/settings/payment/subscriptionDates.ts': 'hebrew-source',
  'components/settings/questionnaire/builderCopy.ts': 'hebrew-source',
  'components/settings/security/IpsTable.tsx': 'hebrew-source',
  'components/settings/templates/TemplatePendingNotice.tsx': 'hebrew-source',
  'components/settings/templates/TemplatesSection.tsx': 'hebrew-source',
  'components/settings/templates/WhatsappMessagePreview.tsx': 'hebrew-source',
  'components/settings/templates/copy.ts': 'hebrew-source',
  'components/taskTmplts/TaskTmpltsTable.tsx': 'hebrew-source',
  'components/tasks/ClientTasksTable.tsx': 'hebrew-source',
  'components/tasks/TasksTable.tsx': 'hebrew-source',
  'components/trial/CardTrialSetupForm.tsx': 'hebrew-source',
  'modules/adsReporting/notices.ts': 'hebrew-source',
  'modules/inbox/mobile/relativeTime.ts': 'hebrew-source',
  'modules/notifications/dropdown.ts': 'hebrew-source',
  'modules/templates/mobile/ReadyMessagesScreen.tsx': 'hebrew-source',
  'components/files/funcs.tsx': 'hebrew-source', // uploadS3's thrown sentences, worded by exact sentence in FileUploader
  'components/files/Glry.tsx': 'hebrew-default',
  'components/layout/SkipLink.tsx': 'hebrew-default',
  'components/settings/connections/SetupGuidePanel.tsx': 'hebrew-default',
  'components/settings/payment/UpgradeBtn.tsx': 'hebrew-default',
  'components/ui/lead-avatar.tsx': 'hebrew-default',
  'modules/facebookComments/actions.ts': 'server-text',
  'modules/inbox/queries.ts': 'server-text',
  'modules/messenger/actions.ts': 'server-text',
  'modules/messenger/leadActions.ts': 'server-text',
  'modules/messenger/savedReplyActions.ts': 'server-text',
}
