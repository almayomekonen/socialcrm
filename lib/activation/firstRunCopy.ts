/**
 * First-run activation copy — ONE source of truth for desktop and mobile.
 *
 * WHY THIS FILE EXISTS. The two first-run screens had already drifted into
 * different products. Desktop opened with "בוא נכניס את הלידים שלך ל־SocialCRM";
 * mobile opened with "בואו נתחיל" — a greeting carrying no information at all.
 * Desktop described WhatsApp as "נהל שיחות עם לקוחות במקום אחד"; mobile labelled
 * the same row "לא מחובר". Neither screen contained a single sentence saying what
 * SocialCRM would do for the business reading it.
 *
 * Layout stays platform-specific — a phone list and a desktop tile grid are
 * genuinely different jobs. The MESSAGE does not get to differ, so it lives here
 * where it cannot drift again.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THE COPY FOLLOWS: outcome before work.
 *
 * A brand-new user is asked to do something only after being told what it will
 * produce. Every string below names a result, never a mechanism and never a
 * configuration state. Production evidence for why: four consecutive mobile
 * signups reached the workspace, were shown four things to do and no reason to
 * do any of them, and left within 4–8 seconds without touching a control.
 *
 * ---------------------------------------------------------------------------
 * HONESTY CONSTRAINTS — each of these was checked against the code, not assumed.
 * `care-charter.md` Law 1: the product never claims a capability it lacks.
 *
 *  · "מהמודעות" is load-bearing and must not be dropped from the Meta line.
 *    Meta ingestion is LEAD ADS only (`lib/system/createClientFromWebhook.ts`,
 *    driven by the leadgen webhook). Facebook and Instagram DMs are NOT
 *    ingested. "לידים מפייסבוק ואינסטגרם" without "מהמודעות" would promise a
 *    product that does not exist.
 *  · The WhatsApp line claims two things and both are true:
 *    `lib/system/createLeadFromWhatsappWebhook.ts` creates the lead, and the
 *    inbox retains the conversation.
 *  · No volume, count, or timing promise anywhere. Nothing like "leads within
 *    24 hours" — we do not control when someone's ad delivers.
 *  · Terminology is `ux-guidelines.md` §6: ליד / לידים only. This file replaces
 *    two live uses of "לקוחות" on the desktop screen.
 *  · No emoji (`CLAUDE.md` §12).
 *
 * ---------------------------------------------------------------------------
 * VOICE. Prose addresses the user in the plural (חברו / הוסיפו); button labels
 * stay singular imperative (הוסף ליד), which is the convention already used
 * across the app's controls. Desktop previously mixed singular prose into the
 * same screen as plural mobile prose; unifying on plural gives the product one
 * voice, per `frontend-experience-guidelines.md` §22.
 *
 * ---------------------------------------------------------------------------
 * LANGUAGE. The words live in the catalog (`leads.firstRun.*`, Hebrew source in
 * lib/i18n/messages/he/leads/firstRun.ts); `firstRunCopy(locale)` reads them in
 * the interface language and `FIRST_RUN_COPY` is the Hebrew copy, unchanged.
 */

import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'

export function firstRunCopy(locale: UiLocale = 'he') {
  const t = translatorFor(locale)
  const n = (count: number) => ({ count: String(count) })
  return {
    /**
     * The sentence the screen never had. Answers "what is this" before anything
     * is asked of the reader. Verb-free on purpose so one string serves both
     * surfaces without a singular/plural fork.
     */
    /**
     * States the true state of the account: OPEN, and empty. Never "ready".
     *
     * "מוכן" was the product's habit — the welcome modal said the Pro plan was
     * ready, the activation screen said the workspace was ready — and both were
     * true about the software while the user still had nothing. A new user heard
     * a claim about their business, went looking for the part that was ready,
     * and left. Naming the emptiness is what makes the next line worth reading.
     */
    headline: t('leads.firstRun.headline'),
    subhead: t('leads.firstRun.subhead'),

    /**
     * PATH 1 — the product promise. Connecting is what makes the CRM fill itself,
     * so it is recommended. It is not the only legitimate path: it delivers zero
     * leads today and only pays off on the next inbound.
     */
    connect: {
      heading: t('leads.firstRun.connect.heading'),
      rationale: t('leads.firstRun.connect.rationale'),
      recommendedBadge: t('leads.firstRun.connect.recommendedBadge'),
      whatsapp: {
        title: t('leads.firstRun.connect.whatsapp.title'),
        description: t('leads.firstRun.connect.whatsapp.description'),
        href: '/settings/integrations?section=whatsapp',
      },
      meta: {
        title: t('leads.firstRun.connect.meta.title'),
        description: t('leads.firstRun.connect.meta.description'),
        href: '/settings/integrations?section=facebook',
      },
    },

    /**
     * PATH 2 — immediate value, and deliberately NOT framed as a fallback.
     *
     * `product.md` §7 names the Excel import as the product's first success
     * moment ("within 60 seconds they can see all their leads organized"), and it
     * is the only path that delivers real data on day one. It gets its own
     * heading and its own reason to exist, not a footnote under the "real" option.
     */
    own: {
      heading: t('leads.firstRun.own.heading'),
      rationale: t('leads.firstRun.own.rationale'),
      recommendedBadge: t('leads.firstRun.own.recommendedBadge'),
      /**
       * Named by its OUTCOME, not by its file format. "ייבוא מאקסל" describes a
       * mechanism the user has no appetite for; "הרשימה שלכם, מסודרת" describes
       * the thing they came to get. The formats belong in the description, where
       * they answer "can I?" instead of asking "do you want to?".
       */
      import: {
        title: t('leads.firstRun.own.import.title'),
        description: t('leads.firstRun.own.import.description'),
      },
      add: { title: t('leads.firstRun.own.add.title'), description: t('leads.firstRun.own.add.description') },
    },

    /**
     * The paste path. On a phone — and especially inside Facebook's in-app
     * browser, where a measurable share of signups land — there is no spreadsheet
     * to pick, so a file input is a dead end. A column of numbers from WhatsApp
     * is the list these users actually have.
     */
    paste: {
      tabFile: t('leads.firstRun.paste.tabFile'),
      tabPaste: t('leads.firstRun.paste.tabPaste'),
      label: t('leads.firstRun.paste.label'),
      placeholder: t('leads.firstRun.paste.placeholder'),
      hint: t('leads.firstRun.paste.hint'),
      /** Count is filled in by the caller — never a promise before parsing. */
      submit: (count: number) => t('leads.firstRun.paste.submit', n(count)),
      submitEmpty: t('leads.firstRun.paste.submitEmpty'),
      pending: t('leads.firstRun.paste.pending'),
      skipped: (count: number) => t('leads.firstRun.paste.skipped', n(count)),
      truncated: t('leads.firstRun.paste.truncated'),
      empty: t('leads.firstRun.paste.empty'),
    },

    /**
     * The workspace has a connected Meta account but no leads yet. A DIFFERENT
     * situation from first run and it keeps different copy: this user has already
     * acted, so the screen's job is reassurance that the action worked, not
     * persuasion. "אין עדיין לידים" is honest here precisely because the wait is
     * expected and explained.
     */
    connected: {
      headline: t('leads.firstRun.connected.headline'),
      subhead: t('leads.firstRun.connected.subhead'),
    },

    /**
     * Shown ONLY when true. A first-time visitor is never greeted by a column of
     * "לא מחובר" labels, which read as a broken setup checklist rather than an
     * offer — the single most damaging detail on the current mobile screen.
     */
    statusConnected: t('leads.firstRun.statusConnected'),

    /**
     * THE STATE NOBODY HAD DESIGNED: leads just landed, and now what?
     *
     * Import used to drop the user straight into an ordinary table. In production
     * five of six leads created by new agencies were never opened again, and
     * `first_follow_up_set` had never fired once in the product's history — the
     * loop simply had no next step after the data arrived.
     *
     * This names the one action worth taking, and points at a specific lead, so
     * the user leaves with a follow-up set instead of a list to admire.
     */
    firstImport: {
      title: (count: number) => t('leads.firstRun.firstImport.title', n(count)),
      body: t('leads.firstRun.firstImport.body'),
      /**
       * Rows the file carried that we could not turn into לידים. Reported here
       * because routing straight to the list skips the importer's own invalid
       * panel — and a customer silently losing rows from their file is exactly
       * the kind of quiet data loss `care-charter.md` Law 1 forbids.
       */
      skipped: (count: number) => t('leads.firstRun.firstImport.skipped', n(count)),
      cta: t('leads.firstRun.firstImport.cta'),
      dismiss: t('leads.firstRun.firstImport.dismiss'),
    },
  }
}

/** The Hebrew copy — what every existing importer (mobile sheets, tests) has always read. */
export const FIRST_RUN_COPY = firstRunCopy('he')

/**
 * First-lead guidance — the words the desktop `FirstLeadCallout` already uses,
 * lifted here so the phone says the same thing. Same rule as FIRST_RUN_COPY:
 * layout may differ per surface, the message may not.
 */
export const FIRST_LEAD_MOBILE = {
  title: 'הליד הראשון שלך בפנים',
  body: 'קבעו מתי לחזור אליו, ו־SocialCRM ידאג להזכיר לכם בזמן.',
  cta: 'קבע מתי לחזור אליו',
} as const
