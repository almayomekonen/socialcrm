# seo-design-reference.md — The SEO Section: Product & UX Reference

**Status:** descriptive reference. No code, no redesign, no recommendations-as-instructions.
The single source of truth for the SEO section before any redesign begins.
**Scope:** every route under `app/(marketing)/`, plus the metadata, structured-data, sitemap and
robots machinery that serves them.
**Method:** read from the working tree on branch `feature/settings-integrations-consolidation`.
Every claim cites a file. Where the implementation contradicts an assumption, the implementation wins.
**Authority:** subordinate to `CLAUDE.md`, `claude/ux-guidelines.md`,
`claude/frontend-experience-guidelines.md`, `claude/architecture-rules.md`, and `claude/care-charter.md`.

> **Reading note for Claude Design.** This document describes what exists today, objectively.
> Section 12 (UX Analysis), 13 (Storytelling) and 14 (Design Consistency) contain observations
> about the current experience — they are findings, not briefs. Nothing here proposes a design.

---

## 0. Orientation in one paragraph

The SEO section is a **13-route Hebrew marketing site** living in the `(marketing)` route group of
the same Next.js App Router application as the product. It is entirely static — no database, no
server actions, no forms, no authenticated state. Its job is to rank for Israeli small-business
CRM queries, explain the product, and move the visitor to exactly one destination: `/auth`.
Every page is built from a shared kit of ~15 marketing components, wrapped in a common layout that
injects three site-wide JSON-LD graphs and a footer. Metadata is centralized in one builder;
structured data is split between a shared helper library and per-page literals. The section has
three distinct page archetypes that arrived in three generations, and they have not been
reconciled with each other.

---

## 1. Executive Summary

**What the SEO section is.** A Hebrew-language, RTL, statically-rendered marketing site of 13
routes targeting Israeli SMB lead-management keywords. It shares the application shell
(`app/layout.tsx`) with the product but has its own route-group layout, its own navigation, its
own footer, and its own visual language.

**What it is trying to do.** Capture organic search for six keyword clusters — generic CRM/lead
management, Facebook Lead Ads, WhatsApp, Instagram, WhatsApp Business specifically, and
CRM-versus-Excel — and funnel every visitor to free registration at `/auth`.

**How it is built.** Three layers:

1. **Route pages** (`app/(marketing)/*/page.tsx`) — each owns its copy, its FAQ content, and its
   page-level JSON-LD.
2. **Shared marketing kit** — `components/seo/` (8 section components + JsonLd + FAQ builder) and
   `components/ui/` (navbar, footer, FAQ tabs, feature grid, animated CTA, comparison table,
   bento, pricing).
3. **SEO infrastructure** — `lib/seo/metadata.ts` (one metadata builder, used by all 13 pages),
   `lib/seo/schemas.ts` (5 schema builders), `app/sitemap.ts`, `app/robots.ts`, `public/llms.txt`,
   `public/manifest.json`.

**The single most important structural fact.** `app/(marketing)/page.tsx` — the homepage — is a
12-line file that **re-exports the default component from `/crm`**. The homepage and `/crm` render
the identical React tree and differ only in metadata. `/crm` then declares its canonical as `/`.
So one component serves two URLs, one of which points search engines at the other.

**Three page archetypes exist, from three generations.** They differ in hero construction,
section order, schema authoring style, and whether they carry a related-links block. No page
follows all three conventions. Section 11 and 14 document this in full.

**What the section does not have.** No forms, no dialogs, no tables of user data, no empty states,
no loading states, no error states, no success states, no database access, no server actions, no
API routes of its own. The only interactive surfaces are the mobile nav drawer, FAQ category tabs,
a comparison-table category filter, a pricing billing-cycle toggle, and hover/scroll animations.
The one exception is `/thank-you`, which reads `searchParams`.

---

## 2. SEO System Overview

### 2.1 Purpose in the product

The product's north star (`claude/product.md`) is a נציג understanding a screen in 5 seconds and
acting in 10–20. The SEO section serves the moment **before** that: a business owner searching in
Hebrew for a way to stop losing leads. Its output is a registration, not a task completed.

### 2.2 The six keyword clusters

| Cluster                        | Route                        | Hebrew intent targeted                       |
| ------------------------------ | ---------------------------- | -------------------------------------------- |
| Generic CRM / lead management  | `/` and `/crm`               | "מערכת ניהול לידים", "CRM לעסקים קטנים"      |
| Product capability             | `/features`                  | "פיצ'רים", what the system does              |
| Facebook Lead Ads              | `/facebook-leads`            | "לידים מפייסבוק"                             |
| WhatsApp                       | `/whatsapp-leads`            | "לידים מוואטסאפ"                             |
| WhatsApp Business (comparison) | `/crm-for-whatsapp-business` | "WhatsApp Business CRM", labels vs. statuses |
| Instagram                      | `/instagram-leads-crm`       | "לידים מאינסטגרם"                            |
| Excel displacement             | `/crm-vs-excel`              | "CRM לעומת אקסל"                             |

Plus commercial (`/pricing`), legal (`/privacy`, `/terms`, `/data-deletion`) and a utility page
(`/thank-you`).

### 2.3 Rendering model

Every marketing page is a **React Server Component** rendered statically. There is no data
fetching, no `generateStaticParams`, no dynamic segments. Interactivity is isolated in
`'use client'` leaf components. `/thank-you` is `async` and awaits `searchParams`, making it the
only dynamically-rendered page in the group.

### 2.4 Language and direction

`app/layout.tsx` sets `<html lang='he' dir='rtl'>` globally. `components/seo/MarketingLayout.tsx`
redundantly re-declares `lang='he' dir='rtl'` on an inner `<div>`, and most page sections declare
`dir='rtl'` again on their own containers. All body copy is Hebrew; brand and product names
(`SocialCRM`, `CRM vs אקסל`, `WhatsApp Business`) are wrapped in `dir='ltr'` spans where mixed
bidi would otherwise break.

---

## 3. Architecture

### 3.1 Route group and layout nesting

```
app/layout.tsx                        ← <html lang='he' dir='rtl'>, Assistant font,
  │                                     global metaData (types/vars.ts), MetaPixel,
  │                                     ToastMsg, ChunkReloader
  └── app/(marketing)/layout.tsx      ← 3 site-wide JSON-LD graphs, <main>, Footer4Col
        ├── page.tsx                  ← re-exports crm/page.tsx
        ├── crm/page.tsx
        ├── features/page.tsx
        ├── facebook-leads/page.tsx
        ├── whatsapp-leads/page.tsx
        ├── instagram-leads-crm/page.tsx
        ├── crm-for-whatsapp-business/page.tsx
        ├── crm-vs-excel/page.tsx
        ├── pricing/page.tsx
        ├── privacy/page.tsx
        ├── terms/page.tsx
        ├── data-deletion/page.tsx
        └── thank-you/page.tsx
```

`app/(marketing)/layout.tsx` in full:

```tsx
<div lang='he' dir='rtl' data-scroll-behavior='smooth'>
  <JsonLd data={organizationSchema()} />
  <JsonLd data={softwareApplicationSchema()} />
  <JsonLd data={websiteSchema()} />
  <Suspense>
    <main>{children}</main>
  </Suspense>
  <Footer4Col />
</div>
```

Consequences worth knowing: the three global JSON-LD graphs render on **every** marketing route,
including `/thank-you` (which is `noindex`) and the three legal pages. `Footer4Col` likewise
appears on all 13 routes. The `<main>` landmark is owned here — `app/layout.tsx` deliberately uses
a neutral `<div>` so there is exactly one `<main>` per document.

### 3.2 The second, inner layout

`components/seo/MarketingLayout.tsx` is a separate 6-line component — a `<div className='min-h-screen'>`
with `backgroundColor: '#0a0a0a'`. It is **not** the route-group layout. It is imported and wrapped
manually by 10 of the 13 pages. Two pages skip it (`/pricing`, `/thank-you`), and the homepage
inherits it through `/crm`.

Its only function is to paint the near-black page background that shows between sections. Pages
that skip it sit on white.

### 3.3 Three page archetypes

| Archetype                  | Pages                                                              | Hero                                                          | Section order                                                                                               | Schema authoring                                         | Related links                                           |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| **A — Product home**       | `/`, `/crm`                                                        | `HeroSection` (own navbar + `HeroContent` + `HeroScene`)      | Hero → Features7 → Orbital → HowItWorks → Stats → LeadSources → Testimonials → AnimatedCta → FAQ → FinalCTA | inline literals                                          | none                                                    |
| **B — Blue-panel landing** | `/features`, `/facebook-leads`, `/whatsapp-leads`, `/crm-vs-excel` | blue gradient stack + `MarketingNavbar` + white rounded panel | Hero → (Stats strip) → (Bento / Table) → FeatureGrid → AnimatedCta → (Stats) → FAQ → **ראה גם** → FinalCTA  | inline literals                                          | yes (`/features`, `/facebook-leads`, `/whatsapp-leads`) |
| **C — Cluster landing**    | `/instagram-leads-crm`, `/crm-for-whatsapp-business`               | identical blue panel to B                                     | Hero → Pain points → Stats strip → Solution → FeatureGrid → AnimatedCta → FAQ → FinalCTA                    | **shared helpers** (`webPageSchema`, `breadcrumbSchema`) | none                                                    |
| **D — Legal**              | `/privacy`, `/terms`, `/data-deletion`                             | none                                                          | single `<section>`, h1 + "עודכן לאחרונה" + stacked h2 blocks                                                | none                                                     | none                                                    |
| **E — Utility**            | `/thank-you`                                                       | none                                                          | centred card                                                                                                | none                                                     | none                                                    |
| **F — Commercial**         | `/pricing`                                                         | bare `MarketingNavbar` on white                               | PricingComponent → AiValue → WhatChanges → PricingFAQ                                                       | **none**                                                 | none                                                    |

Archetype C is the newest and the only one using the shared schema helpers. Archetype B is the
most numerous. Archetype A is the most visually elaborate.

### 3.4 Dependency map

```
app/(marketing)/*/page.tsx
   ├── lib/seo/metadata.ts ......... buildPageMetadata()   [all 13 pages]
   ├── lib/seo/schemas.ts .......... webPageSchema, breadcrumbSchema   [2 pages]
   ├── components/seo/JsonLd.tsx ... <script type=application/ld+json> [9 pages]
   ├── components/seo/FAQ.tsx ...... buildFAQSchema()      [6 pages]
   ├── components/seo/MarketingLayout.tsx                  [10 pages]
   ├── components/seo/CRMSections.tsx  (barrel)
   │      └── components/seo/sections/*.tsx  (8 sections)
   ├── components/marketing/MarketingNavbar.tsx            [7 pages]
   └── components/ui/*  (faq-tabs, feature-section, animated-cta,
                         crm-comparison-table, magnified-bento,
                         pricing-card, footer-column, hero/*)
```

---

## 4. User Journey

### 4.1 Entry

Every marketing page is a potential **organic search landing page** — that is the section's whole
purpose. There is no "start here" page in practice. Secondary entries: the footer social links
(Facebook, Instagram, email) point outward, not inward; `next.config.mjs` defines no redirects
into the section.

### 4.2 The canonical funnel

```
Organic search
     │
     ▼
Any marketing route ──► MarketingNavbar (6 links) ──► sibling marketing route
     │                          │
     │                          └──► "התחל בחינם" ──┐
     │                                              │
     ├──► Hero primary CTA ────────────────────────►├──► /auth  (registration)
     ├──► FeatureGrid CTA ─────────────────────────►│
     ├──► AnimatedCta ─────────────────────────────►│
     ├──► FinalCTA ────────────────────────────────►┘
     │
     ├──► Hero secondary CTA ──► /crm or /features  (lateral, educational)
     ├──► "ראה גם" block ──────► 3 sibling routes    (3 of 13 pages)
     └──► Footer4Col ─────────► 16 internal links + 3 external
```

**Every conversion path terminates at `/auth`.** The single exception is `/pricing`, where the Pro
plan CTA goes to `/api/payments/upgrade?period=…&source=marketing_pricing`, which itself redirects
anonymous visitors to login.

### 4.3 CTA density

A typical archetype-B page presents the visitor with the same "start free" action **five times**:
navbar, hero, FeatureGrid footer, AnimatedCta, FinalCTA. The label varies by page
(`התחל בחינם עכשיו`, `חבר את הפייסבוק שלך עכשיו`, `חברו את הוואטסאפ בחינם`,
`עוברים למערכת בחינם`) but the destination is always `/auth`.

### 4.4 Exit points

- `/auth` — the intended exit.
- Legal pages — reachable from the footer on every page; they carry **no navbar**, so the only way
  back into the site is the footer or the browser's back button.
- External — three footer social/email links.

---

## 5. Page Inventory

| #   | Route                        | Archetype | In sitemap | Indexable       | Priority | JSON-LD on page                    | Navbar          | Lines |
| --- | ---------------------------- | --------- | ---------- | --------------- | -------- | ---------------------------------- | --------------- | ----- |
| 1   | `/`                          | A         | ✓          | ✓               | 1.0      | 3 (inherited from `/crm`)          | via HeroSection | 12    |
| 2   | `/crm`                       | A         | ✗          | canonical → `/` | —        | 3                                  | via HeroSection | 172   |
| 3   | `/features`                  | B         | ✓          | ✓               | 0.85     | 1 (FAQ)                            | ✓               | 248   |
| 4   | `/facebook-leads`            | B         | ✓          | ✓               | 0.85     | 3 (FAQ, HowTo, WebPage+breadcrumb) | ✓               | 314   |
| 5   | `/whatsapp-leads`            | B         | ✓          | ✓               | 0.8      | 2 (WebPage, FAQ)                   | ✓               | 285   |
| 6   | `/crm-vs-excel`              | B         | ✓          | ✓               | 0.8      | 2 (WebPage, FAQ)                   | ✓               | 237   |
| 7   | `/crm-for-whatsapp-business` | C         | ✓          | ✓               | 0.7      | 3 (WebPage, FAQ, breadcrumb)       | ✓               | 317   |
| 8   | `/instagram-leads-crm`       | C         | ✓          | ✓               | 0.7      | 3 (WebPage, FAQ, breadcrumb)       | ✓               | 322   |
| 9   | `/pricing`                   | F         | ✓          | ✓               | 0.9      | **0**                              | ✓               | 23    |
| 10  | `/privacy`                   | D         | ✓          | ✓               | 0.3      | 0                                  | ✗               | 94    |
| 11  | `/terms`                     | D         | ✓          | ✓               | 0.3      | 0                                  | ✗               | 76    |
| 12  | `/data-deletion`             | D         | ✓          | ✓               | 0.3      | 0                                  | ✗               | 69    |
| 13  | `/thank-you`                 | E         | ✗          | **noindex**     | —        | 0                                  | ✗               | 33    |

Sitemap contains 11 URLs. The two omissions are deliberate: `/crm` canonicalizes to `/`, and
`/thank-you` is `noindex` **and** disallowed in `robots.ts`.

---

## 6. Detailed Page Documentation

### 6.0 The shared static-page contract

To avoid repeating thirteen identical "none" rows, these hold for **every** page in the section
unless the page's own entry states otherwise:

| Field                   | Value across the section                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Forms**               | None. No `<form>` element exists on any marketing page except the logout form inside the mobile nav drawer.                                                                                                                     |
| **Tables**              | None, except `/crm-vs-excel` (`CRMComparisonTable`).                                                                                                                                                                            |
| **Dialogs / modals**    | None. The mobile nav drawer is a full-screen slide-over, not a dialog.                                                                                                                                                          |
| **Empty states**        | None — no page renders a collection that can be empty.                                                                                                                                                                          |
| **Loading states**      | None — statically rendered, no fetches. `/crm` lazy-loads `TestimonialsSection` via `next/dynamic` with no loading fallback.                                                                                                    |
| **Error states**        | None. No error boundary is defined in the route group.                                                                                                                                                                          |
| **Success states**      | None, except `/thank-you`, which _is_ a success state.                                                                                                                                                                          |
| **Data sources**        | None. All copy is hardcoded in the page module.                                                                                                                                                                                 |
| **APIs**                | None called at render. `/pricing` navigates to `/api/payments/upgrade` on click.                                                                                                                                                |
| **Server actions**      | None, except `getSessionState` and `logout` used inside `MarketingNavbar`.                                                                                                                                                      |
| **Database queries**    | None.                                                                                                                                                                                                                           |
| **Metadata generation** | `buildPageMetadata()` from `lib/seo/metadata.ts` — static `export const metadata`, never `generateMetadata`.                                                                                                                    |
| **Canonical logic**     | `buildPageMetadata` sets `alternates.canonical = 'https://getsocialcrm.com' + path` unless a `canonical` override is passed.                                                                                                    |
| **Open Graph**          | Built by the same helper: `og:title`, `og:description`, `og:url` (= canonical), `og:site_name`, `og:locale = he_IL`, `og:type = website`, and one 1200×630 PNG at an absolute URL. Twitter mirrors it as `summary_large_image`. |

---

### 6.1 `/` — Homepage

| Field                        | Detail                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**                  | Rank for the head term ("מערכת ניהול לידים לעסקים קטנים") and convert generic traffic.                                                                                                    |
| **Route**                    | `/` — `app/(marketing)/page.tsx`                                                                                                                                                          |
| **Target user**              | An Israeli small-business owner or sales rep losing leads across Facebook, Instagram and WhatsApp.                                                                                        |
| **User goal**                | Understand what the product is and whether it solves their scattered-leads problem.                                                                                                       |
| **Entry points**             | Organic search on head terms; navbar logo from every marketing page; direct/brand traffic.                                                                                                |
| **Navigation flow**          | Lands → hero → scrolls the seven-section story → CTA at any of four points → `/auth`.                                                                                                     |
| **Current layout**           | **The file is a 12-line re-export.** It sets its own metadata and then `export { default } from '@/app/(marketing)/crm/page'`. The rendered tree is byte-identical to `/crm` — see 6.2.   |
| **Information hierarchy**    | See 6.2.                                                                                                                                                                                  |
| **Components used**          | See 6.2.                                                                                                                                                                                  |
| **Available actions**        | See 6.2.                                                                                                                                                                                  |
| **Metadata**                 | `title: 'SocialCRM — מערכת ניהול לידים לעסקים קטנים'`; `ogTitle: 'SocialCRM — מערכת ניהול לידים'`; `ogDescription: 'כל הלידים מפייסבוק, אינסטגרם ווואטסאפ. במקום אחד. בלי לפספס אף ליד.'` |
| **Canonical**                | `https://getsocialcrm.com/` (derived from `path: '/'`).                                                                                                                                   |
| **Structured data**          | Inherits `/crm`'s three graphs — `SoftwareApplication` (`@id .../#software`), `HowTo`, `FAQPage` — plus the layout's Organization / WebSite / SoftwareApplication.                        |
| **Internal links**           | Identical to `/crm`.                                                                                                                                                                      |
| **Connection to the system** | The hub. Every navbar logo and every breadcrumb "דף הבית" points here.                                                                                                                    |

---

### 6.2 `/crm` — Lead-management guide (renders the homepage tree)

| Field                        | Detail                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**                  | A keyword-targeted duplicate of the homepage for "ניהול לידים" / "CRM", canonicalized to `/`.                                                                                                                                                                                                                                                                                                      |
| **Route**                    | `/crm` — `app/(marketing)/crm/page.tsx` (172 lines)                                                                                                                                                                                                                                                                                                                                                |
| **Target user**              | Same as `/`, arriving on a more explicit query.                                                                                                                                                                                                                                                                                                                                                    |
| **User goal**                | Learn what lead management is and see the product answer it.                                                                                                                                                                                                                                                                                                                                       |
| **Entry points**             | Navbar link "ניהול לידים"; **four** footer links — "פתרונות → ניהול לידים" and "משאבים → ניהול לידים המדריך" resolve to `/crm`, while "משאבים → שאלות נפוצות" and "משאבים → איך זה עובד" resolve to `/crm#faq` and `/crm#how-it-works`; hero secondary CTA on `/features` and `/facebook-leads`.                                                                                                                                                                                                                                                      |
| **Navigation flow**          | Seven scroll sections, then FAQ, then final CTA.                                                                                                                                                                                                                                                                                                                                                   |
| **Current layout**           | `HeroSection` (contains its own `MarketingNavbar`, `HeroContent`, `HeroScene`) → `Features7Section` → `OrbitalFeaturesSection` → `HowItWorksSection` → `StatsSection` → `LeadSourcesSection` → `TestimonialsSection` (lazy) → `AnimatedCta` → `FAQ` → `FinalCTA`.                                                                                                                                  |
| **Information hierarchy**    | 1. h1 "כל ליד. / במקום אחד. / **בלי לפספס.**" with `ChannelBadges` above it. 2. Sub-paragraph naming the three channels. 3. Primary CTA "התחל בחינם" + secondary anchor "איך זה עובד" (`#how-it-works`). 4. Four capability highlights + a mock leads table. 5. Orbital feature timeline. 6. Rotating-word stats banner. 7. Lead-source carousel. 8. Testimonials. 9. FAQ (4 tabs). 10. Final CTA. |
| **Components used**          | `HeroSection`, `HeroContent`, `HeroScene`, `ChannelBadges`, `Features7Section`, `OrbitalFeaturesSection`, `HowItWorksSection` → `HowItWorks`, `StatsSection` → `TextRotate`, `LeadSourcesSection` → `FeatureCarousel`, `TestimonialsSection` → `StaggerTestimonials`, `AnimatedCta`, `FAQ` (faq-tabs), `FinalCTA` → `ParticleTextEffect`, `Btn`, `Icon`.                                           |
| **Cards**                    | Mock lead rows in `Features7Section`; orbital nodes rendered as cards on mobile (`MobileFeatureCards`); testimonial cards. All decorative — none are interactive product data.                                                                                                                                                                                                                     |
| **Available actions**        | Primary: `/auth` (×4 — hero, AnimatedCta, FinalCTA, navbar). Secondary: `#how-it-works` anchor, `/features` (FinalCTA), 6 navbar links, 16 footer links. Micro-interactions: FAQ tab switching, orbital node selection, carousel.                                                                                                                                                                  |
| **Structured data**          | Three page-level graphs: `SoftwareApplication` with `@id: https://getsocialcrm.com/#software`; `HowTo` ("איך מתחילים לנהל לידים לעסק קטן", 5 steps); `FAQPage` built from an 8-item `faqItems` array.                                                                                                                                                                                              |
| **Canonical**                | **Overridden** to `https://getsocialcrm.com/` — the only page in the section passing an explicit `canonical`.                                                                                                                                                                                                                                                                                      |
| **Note on FAQ content**      | The `faqItems` array (8 questions) feeds `buildFAQSchema`. The **rendered** `FAQ` component receives a different, larger inline object (12 questions across 4 tabs). The two overlap but are not the same set — e.g. "האם אפשר לשייך לידים לנציגים שונים?" renders on screen but is absent from the schema, and one question's wording differs between the two.                                    |
| **Internal links**           | `/auth`, `/features`, `#how-it-works`, plus navbar and footer.                                                                                                                                                                                                                                                                                                                                     |
| **Connection to the system** | The canonical destination of the "learn what this is" intent; the secondary CTA target for `/features` and `/facebook-leads`.                                                                                                                                                                                                                                                                      |

---

### 6.3 `/features` — Capability overview

| Field                        | Detail                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**                  | Enumerate what the product does, for visitors comparing capability.                                                                                                                                                                                                                                            |
| **Route**                    | `/features` — 248 lines                                                                                                                                                                                                                                                                                        |
| **Target user**              | A visitor past the "what is this" stage, checking whether specific capabilities exist.                                                                                                                                                                                                                         |
| **User goal**                | Confirm the system covers their channels and their team setup.                                                                                                                                                                                                                                                 |
| **Entry points**             | Navbar "פיצ'רים"; footer ×2 ("פיצ'רים", "ייבוא מאקסל"); `FinalCTA` secondary button on **every** page; hero secondary CTA on `/whatsapp-leads` and `/crm-vs-excel`; "ראה גם" blocks.                                                                                                                           |
| **Navigation flow**          | Hero → six feature categories → CTA → stats → FAQ → related links → final CTA.                                                                                                                                                                                                                                 |
| **Current layout**           | Blue-gradient hero stack with `MarketingNavbar` and a white rounded panel → `FeatureGrid` (6 categories × 3 items) → `AnimatedCta` → `StatsSection` → `FAQ` (3 tabs) → "ראה גם" → `FinalCTA`.                                                                                                                  |
| **Information hierarchy**    | 1. Purple badge "הפיצ׳רים". 2. h1 "כל מה שצריך כדי לנהל לידים / במערכת אחת פשוטה". 3. Sub-paragraph. 4. Dual CTA: outline "קרא עוד על ניהול לידים" → `/crm`, solid "התחל בחינם עכשיו" → `/auth`. 5. Six feature cards. 6. Full-bleed animated CTA. 7. Rotating stats. 8. FAQ. 9. Related links. 10. Final CTA. |
| **Components used**          | `MarketingLayout`, `MarketingNavbar`, `FeatureGrid`, `AnimatedCta`, `StatsSection`, `FAQ`, `FinalCTA`, `JsonLd`, `Btn`, `Icon`, `Link`.                                                                                                                                                                        |
| **Cards**                    | Six `FeatureGrid` categories: Facebook/Instagram connection, WhatsApp, Excel import, team management, tracking & closing, performance & reports. Each is an icon + title + three bullet lines. Non-interactive.                                                                                                |
| **Available actions**        | Primary `/auth` (×4). Secondary `/crm`, `/crm-for-whatsapp-business`, `/instagram-leads-crm`, `/crm-vs-excel`, `/features` (self, via FinalCTA).                                                                                                                                                               |
| **Structured data**          | One graph: `FAQPage` from 6 items. **No** `WebPage` node — this page is not tied into the `#website` graph.                                                                                                                                                                                                    |
| **FAQ integrity**            | The rendered tabs re-slice the same `faqItems` array (`general: [0,4,5]`, `features: [2,3]`, `integrations: [1]`), so schema and screen match exactly.                                                                                                                                                         |
| **Internal links**           | `/crm`, `/auth`, `/crm-for-whatsapp-business`, `/instagram-leads-crm`, `/crm-vs-excel`, `/features`.                                                                                                                                                                                                           |
| **Connection to the system** | The most linked-to page in the section — it is the `FinalCTA` secondary target site-wide.                                                                                                                                                                                                                      |

---

### 6.4 `/facebook-leads` — Facebook Lead Ads

| Field                        | Detail                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**                  | Rank for Facebook Lead Ads integration and prove leads arrive automatically.                                                                                                                                                                                                                                                                                                     |
| **Route**                    | `/facebook-leads` — 314 lines                                                                                                                                                                                                                                                                                                                                                    |
| **Target user**              | A business already running Facebook lead ads and copying leads by hand.                                                                                                                                                                                                                                                                                                          |
| **User goal**                | Confirm the connection is real, automatic, and quick to set up.                                                                                                                                                                                                                                                                                                                  |
| **Entry points**             | Navbar "פייסבוק"; footer ×2; "ראה גם" on `/whatsapp-leads`; organic search.                                                                                                                                                                                                                                                                                                      |
| **Current layout**           | Blue hero + navbar + white panel → dark stats strip (3 metrics) → dark `MagnifiedBento` section → white `FeatureGrid` (6 categories) → `AnimatedCta` → `FAQ` (2 tabs) → "ראה גם" → `FinalCTA`.                                                                                                                                                                                   |
| **Information hierarchy**    | 1. Facebook-blue badge "פייסבוק Lead Ads" (`#1877F2`). 2. h1 "כל ליד מפייסבוק נכנס לבד / ומחכה מסודר לטיפול". 3. Sub-paragraph. 4. Dual CTA: outline "ראה איך זה עובד" → `/crm`, solid "חבר את הפייסבוק שלך עכשיו" → `/auth`. 5. Stats: `5 דק׳` setup, `0` forgotten leads, `×3` more closed. 6. Bento visual. 7. Six feature cards. 8. CTA. 9. FAQ. 10. Related. 11. Final CTA. |
| **Components used**          | `MarketingLayout`, `MarketingNavbar`, `MagnifiedBento`, `FeatureGrid`, `AnimatedCta`, `FAQ`, `FinalCTA`, `JsonLd`, `Btn`, `Icon`.                                                                                                                                                                                                                                                |
| **Structured data**          | Three inline graphs: `FAQPage` (6 items), `HowTo` (4 steps, "איך לחבר לידים מפייסבוק למערכת"), and a `WebPage` with an **embedded** `breadcrumb` property (`דף הבית` → `ניהול לידים מפייסבוק`). The breadcrumb is inlined into the WebPage node rather than emitted as a separate `BreadcrumbList` — different from archetype C.                                                 |
| **FAQ integrity**            | `general: faqItems.slice(0,3)`, `setup: faqItems.slice(3)` — schema and screen match.                                                                                                                                                                                                                                                                                            |
| **Internal links**           | `/crm`, `/auth`, `/instagram-leads-crm`, `/crm-for-whatsapp-business`, `/crm-vs-excel`.                                                                                                                                                                                                                                                                                          |
| **Connection to the system** | Channel-cluster sibling of `/whatsapp-leads` and `/instagram-leads-crm`; links to both.                                                                                                                                                                                                                                                                                          |

---

### 6.5 `/whatsapp-leads` — WhatsApp lead management

| Field                        | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**                  | Rank for WhatsApp lead management; show conversations becoming managed leads.                                                                                                                                                                                                                                                                                                                                                                   |
| **Route**                    | `/whatsapp-leads` — 285 lines                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Target user**              | A business whose leads arrive as WhatsApp messages and get buried in the chat list.                                                                                                                                                                                                                                                                                                                                                             |
| **User goal**                | See that each conversation becomes a lead with status, owner and follow-up.                                                                                                                                                                                                                                                                                                                                                                     |
| **Entry points**             | Navbar "וואטסאפ"; footer; "ראה גם" on `/features` and `/facebook-leads`.                                                                                                                                                                                                                                                                                                                                                                        |
| **Current layout**           | Identical skeleton to `/facebook-leads`: blue hero → stats strip → `MagnifiedBento` → `FeatureGrid` → `AnimatedCta` → `FAQ` → "ראה גם" → `FinalCTA`.                                                                                                                                                                                                                                                                                            |
| **Information hierarchy**    | 1. WhatsApp-green badge "וואטסאפ" (`#25D366`). 2. h1 "כל שיחה בוואטסאפ / הופכת לליד מנוהל". 3. Sub-paragraph on delivery/read receipts. 4. Dual CTA: outline "ראה את כל הפיצ׳רים" → `/features`, solid "חברו את הוואטסאפ בחינם" → `/auth`. 5. Stats: `10 שנ׳` to add a lead, `0` forgotten, `×3` closed. 6. Bento. 7. Six feature cards. 8. CTA (label reverts to the generic "התחל בחינם עכשיו"). 9. FAQ (2 tabs). 10. Related. 11. Final CTA. |
| **Structured data**          | Two inline graphs: `WebPage` (no breadcrumb) and `FAQPage` (5 items).                                                                                                                                                                                                                                                                                                                                                                           |
| **FAQ integrity**            | Slices of the same array — schema and screen match.                                                                                                                                                                                                                                                                                                                                                                                             |
| **Internal links**           | `/features`, `/auth`, `/crm-for-whatsapp-business`, `/instagram-leads-crm`, `/crm-vs-excel`.                                                                                                                                                                                                                                                                                                                                                    |
| **Connection to the system** | Overlaps `/crm-for-whatsapp-business` in intent; links to it. The two pages address adjacent queries with different angles (channel capability vs. WhatsApp Business tool comparison).                                                                                                                                                                                                                                                          |

---

### 6.6 `/crm-vs-excel` — Comparison page

| Field                        | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Purpose**                  | Displace Excel as the incumbent; give a visitor a defensible reason to switch.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Route**                    | `/crm-vs-excel` — 237 lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Target user**              | Someone currently tracking leads in a spreadsheet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **User goal**                | Decide whether their volume justifies leaving Excel.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Entry points**             | Navbar "CRM vs אקסל" (`dir='ltr'`); footer; "ראה גם" on `/features`, `/facebook-leads`, `/whatsapp-leads` — the most-linked page from sibling related-blocks.                                                                                                                                                                                                                                                                                                                                                            |
| **Current layout**           | Blue hero → dark stats strip → white `CRMComparisonTable` → white `FeatureGrid` → `AnimatedCta` → `FAQ` (2 tabs) → `FinalCTA`. **No "ראה גם" block**, despite being archetype B.                                                                                                                                                                                                                                                                                                                                         |
| **Information hierarchy**    | 1. Excel-green badge "CRM vs אקסל" (`#217346`, `dir='ltr'`). 2. h1 "מפסיקים לנהל לידים באקסל / _עוברים למערכת שבאמת בנויה למכירות_" (second line in grey). 3. Sub-paragraph promising 16 comparison points. 4. Dual CTA: outline "ראה את כל הפיצ׳רים" → `/features`, solid "עוברים למערכת בחינם" → `/auth`. 5. Stats: `×3` closed, `5 דק׳` saved per lead, `0` forgotten. 6. **The comparison table** — the page's centrepiece. 7. Feature grid framed as "מה SocialCRM עושה במקום אקסל". 8. CTA. 9. FAQ. 10. Final CTA. |
| **Tables**                   | `CRMComparisonTable` — the only real table in the section. A `ROWS` array of feature comparisons, each with an Excel status and a CRM status badge, plus a category. Filterable by five category chips (`הכל`, `לידים`, `ניהול`, `צוות`, `ביצועים`) held in `useState`. Heading: "אקסל מול SocialCRM, תכונה אחרי תכונה".                                                                                                                                                                                                 |
| **Structured data**          | Two inline graphs: `WebPage` and `FAQPage` (4 items).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **FAQ integrity**            | `general: slice(0,2)`, `decision: slice(2)` — matches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Internal links**           | `/features`, `/auth`. Notably **no** links to the channel pages.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Connection to the system** | Terminal in the related-links graph: three pages link _to_ it, it links back only to `/features`.                                                                                                                                                                                                                                                                                                                                                                                                                        |

---

### 6.7 `/crm-for-whatsapp-business` — WhatsApp Business comparison

| Field                        | Detail                                                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**                  | Capture visitors already using WhatsApp Business and arguing with its limits (labels are not a sales process).                                                                                                                                |
| **Route**                    | `/crm-for-whatsapp-business` — 317 lines                                                                                                                                                                                                      |
| **Target user**              | A business using WhatsApp Business labels and quick replies as a de-facto CRM.                                                                                                                                                                |
| **User goal**                | Understand what a CRM adds on top of WhatsApp Business.                                                                                                                                                                                       |
| **Entry points**             | Footer "משאבים"; "ראה גם" on `/features`, `/facebook-leads`, `/whatsapp-leads`. **Not in the navbar.**                                                                                                                                        |
| **Current layout**           | Blue hero + navbar + white panel → **"הסיטואציה הזו מוכרת?" pain-points section** (dark) → stats strip (dark) → **"איך SocialCRM משלים את WhatsApp Business" solution section** (white) → `FeatureGrid` → `AnimatedCta` → `FAQ` → `FinalCTA`. |
| **Information hierarchy**    | Problem → evidence → solution → capability → conversion. This archetype leads with the reader's pain before naming the product, which A and B do not.                                                                                         |
| **Structured data**          | Three graphs, and the **only** generation using shared helpers: `webPageSchema({ path, title, description })`, `buildFAQSchema(faqItems)`, and a standalone `breadcrumbSchema([...])` emitted as its own `BreadcrumbList` node.               |
| **Metadata**                 | `PAGE_PATH` / `PAGE_TITLE` / `PAGE_DESCRIPTION` are hoisted to module constants and reused by both the metadata builder and the schema helper — the only pages that avoid restating strings.                                                  |
| **Internal links**           | `/auth`, plus hero secondary. No "ראה גם" block.                                                                                                                                                                                              |
| **Connection to the system** | Receives links from three pages, emits almost none. A funnel sink.                                                                                                                                                                            |

---

### 6.8 `/instagram-leads-crm` — Instagram leads

| Field                        | Detail                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Purpose**                  | Rank for Instagram lead management and set honest expectations about what Instagram permits.                                                                                                                                                                                               |
| **Route**                    | `/instagram-leads-crm` — 322 lines, the longest page in the section                                                                                                                                                                                                                        |
| **Target user**              | A business getting DMs, story replies and Instagram ad leads.                                                                                                                                                                                                                              |
| **User goal**                | Learn whether Instagram leads can be captured automatically.                                                                                                                                                                                                                               |
| **Entry points**             | Footer "משאבים"; "ראה גם" on `/features`, `/facebook-leads`, `/whatsapp-leads`. **Not in the navbar.**                                                                                                                                                                                     |
| **Current layout**           | Identical to 6.7: Hero → pain points → stats strip → solution → `FeatureGrid` → `AnimatedCta` → `FAQ` → `FinalCTA`.                                                                                                                                                                        |
| **Content note**             | The first FAQ answer states plainly that Instagram does not let external systems read DM content, so DMs are added manually in ~10 seconds, while Meta Lead Ads campaigns connect automatically. This is the section's clearest instance of a capability limit stated rather than glossed. |
| **Structured data**          | Three graphs via the shared helpers, same pattern as 6.7.                                                                                                                                                                                                                                  |
| **Internal links**           | `/auth`, hero secondary. No "ראה גם".                                                                                                                                                                                                                                                      |
| **Connection to the system** | Cluster sibling of `/facebook-leads` (both are Meta channels); same sink shape as 6.7.                                                                                                                                                                                                     |

---

### 6.9 `/pricing` — Plans

| Field                        | Detail                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**                  | Convert an evaluating visitor into a Free registration or a Pro purchase.                                                                                                                                                                                                                |
| **Route**                    | `/pricing` — a 23-line page delegating to `components/ui/pricing-card.tsx` (450 lines)                                                                                                                                                                                                   |
| **Target user**              | A visitor who has decided the product is relevant and is checking cost.                                                                                                                                                                                                                  |
| **User goal**                | Understand what is free, what Pro adds, and what it costs.                                                                                                                                                                                                                               |
| **Entry points**             | Navbar "מחירים"; sitemap priority 0.9 (second-highest). Not linked from the footer.                                                                                                                                                                                                      |
| **Current layout**           | `MarketingNavbar` on white (no `MarketingLayout`, no dark background) → `PricingComponent` (two plan cards + billing-cycle toggle) → `AiValueSection` ("למה Pro") → `WhatChangesSection` (Free-vs-Pro workflow rows) → `PricingFAQ`.                                                     |
| **Information hierarchy**    | 1. h2 headline. 2. Billing-cycle toggle, defaulting to **annually**. 3. Two `PlanCard`s — Free and Pro, Pro featured with a badge. 4. Feature lists per plan. 5. Per-plan CTA button. 6. AI value argument. 7. Workflow comparison. 8. FAQ.                                              |
| **Cards**                    | Two `PlanCard`s. Pro is `isFeatured` (dark treatment, badge). Prices come from `lib/pricing.ts` (`PRICING.monthly = 89`, `PRICING.annual = 588`, `ANNUAL_DISCOUNT_PERCENT`), never hardcoded.                                                                                            |
| **Available actions**        | Free → `router.push('/auth')`. Pro → `window.location.href = '/api/payments/upgrade?period=' + period + '&source=marketing_pricing'`. The route owns auth redirect, annual-link gating, intent recording and analytics; the page only forwards the selection. Toggle → local `useState`. |
| **Structured data**          | **None.** Despite having a visible FAQ and being the commercial page, it emits no `FAQPage`, no `Product`, no `Offer`. The only pricing `Offer` in the section sits on `/crm`'s and the layout's `SoftwareApplication` nodes, both declaring `price: '0'`.                               |
| **Internal links**           | `/auth` (via handler), navbar, footer.                                                                                                                                                                                                                                                   |
| **Connection to the system** | Reachable only from the navbar and sitemap. No marketing page body links to it.                                                                                                                                                                                                          |

---

### 6.10–6.12 `/privacy`, `/terms`, `/data-deletion` — Legal

These three share one template.

| Field                        | Detail                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**                  | Legal compliance; Facebook/Meta app review requires a reachable privacy policy and data-deletion route.                                                                                                                                                                                                  |
| **Routes**                   | `/privacy` (94), `/terms` (76), `/data-deletion` (69)                                                                                                                                                                                                                                                    |
| **Target user**              | A cautious visitor, a platform reviewer, or a user exercising a data right.                                                                                                                                                                                                                              |
| **User goal**                | Find one specific clause, or a deletion contact.                                                                                                                                                                                                                                                         |
| **Entry points**             | Footer "חברה" column and the footer bottom bar — both present on all 13 pages. Sitemap at priority 0.3, `changeFrequency: 'yearly'`.                                                                                                                                                                     |
| **Current layout**           | `MarketingLayout` → one `<section className='py-16 px-8' dir='rtl'>` → `max-w-3xl` column → h1 → "עודכן לאחרונה: מרץ 2026" → a `flex flex-col gap-10` stack of h2 + paragraph blocks.                                                                                                                    |
| **Information hierarchy**    | Flat. Every h2 carries equal weight; there is no table of contents, no anchor links, no in-page navigation.                                                                                                                                                                                              |
| **Components used**          | `MarketingLayout` only. No navbar, no CTA, no JSON-LD. `/data-deletion` additionally renders one bordered white card containing the deletion-request instructions.                                                                                                                                       |
| **Section headings**         | `/privacy`: מבוא, איזה מידע אנו אוספים, כיצד אנו משתמשים במידע, שיתוף מידע, שימוש ב־Facebook, אבטחת מידע, זכויות המשתמש, יצירת קשר. `/terms`: כללי, מטרת השימוש, איסורים, אחריות המשתמש, שינויים בתנאים, יצירת קשר. `/data-deletion`: זכותך למחיקת מידע, כיצד לשלוח בקשת מחיקה, זמן טיפול, שאלות נוספות. |
| **Available actions**        | None on-page except the footer. **No navbar means no direct route back into the site** other than the footer or browser back.                                                                                                                                                                            |
| **Naming note**              | These pages call the product "SocialCRM **Platform**" in titles and body copy; every other page and all schema call it "SocialCRM".                                                                                                                                                                      |
| **Connection to the system** | Leaf nodes. Linked from every page, linking onward only through the shared footer.                                                                                                                                                                                                                       |

---

### 6.13 `/thank-you` — Post-action confirmation

| Field                        | Detail                                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Purpose**                  | Generic success confirmation after an external action.                                                                                                                                                                                                                 |
| **Route**                    | `/thank-you` — 33 lines                                                                                                                                                                                                                                                |
| **Target user**              | Someone who just completed a form or flow elsewhere.                                                                                                                                                                                                                   |
| **User goal**                | Confirm the action worked.                                                                                                                                                                                                                                             |
| **Entry points**             | Redirect targets only. Not linked from any marketing page, not in the sitemap, disallowed in `robots.ts`.                                                                                                                                                              |
| **Current layout**           | Full-height flex column, centred white card with shadow: a green circle with a check icon, h1, paragraph, then `PoweredBySocialCRM`. **No `MarketingLayout`, no navbar** — but the route-group layout still supplies `Footer4Col` and the three global JSON-LD graphs. |
| **Success state**            | This page _is_ the section's only success state.                                                                                                                                                                                                                       |
| **Data sources**             | The only page reading input: `const params = await searchParams`, with `params.title` (default `'תודה!'`) and `params.description` (default `'הפעולה בוצעה בהצלחה'`) rendered directly. This makes it the only dynamically-rendered marketing route.                   |
| **Metadata**                 | `buildPageMetadata({ ..., noindex: true })` → `robots: { index: false, follow: false }`. Metadata is static, so the `<title>` stays "תודה                                                                                                                              | SocialCRM" regardless of the `title` query parameter. |
| **Available actions**        | None beyond the footer. No CTA returns the visitor to the funnel.                                                                                                                                                                                                      |
| **Connection to the system** | Detached. Nothing links in, nothing links out except the footer.                                                                                                                                                                                                       |

---

## 7. Component Inventory

### 7.1 SEO-owned components (`components/seo/`)

| Component                       | File                  | Type   | Used by                        | Role                                                                                                                                                                      |
| ------------------------------- | --------------------- | ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JsonLd`                        | `JsonLd.tsx`          | server | 9 pages                        | Renders `<script type='application/ld+json'>` via `dangerouslySetInnerHTML`. 11 lines, no escaping beyond `JSON.stringify`.                                               |
| `MarketingLayout`               | `MarketingLayout.tsx` | server | 10 pages                       | `min-h-screen` div with `#0a0a0a` background.                                                                                                                             |
| `FAQSection` + `buildFAQSchema` | `FAQ.tsx`             | server | schema builder used by 6 pages | `buildFAQSchema` maps items to `FAQPage`. **`FAQSection` itself is never imported by any page** — the accordion-based renderer is superseded by `components/ui/faq-tabs`. |
| `Hero`                          | `Hero.tsx`            | server | **unused**                     | A breadcrumb + badge + title + dual-CTA hero. No page imports it; every page hand-rolls its hero instead.                                                                 |
| `CRMSections`                   | `CRMSections.tsx`     | barrel | 6 pages                        | Re-exports the 8 section components + `FadeIn`/`SectionHeader`.                                                                                                           |

### 7.2 Section components (`components/seo/sections/`)

| Component                            | Lines | Client | Used by             | Description                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | ----- | ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared` (`FadeIn`, `SectionHeader`) | 31    | ✓      | internal            | `FadeIn` is a `motion/react` scroll-reveal (opacity + 28px rise, `once: true`). `SectionHeader` is a centred badge/title/subtitle block — **used by no page directly**.                                                                                                                          |
| `Features7Section`                   | 102   | ✓      | `/crm`              | Four capability highlights plus `LeadsMockUI`, a fabricated dark leads table with six mock leads (Hebrew names, statuses, sources) mirroring the real product table.                                                                                                                             |
| `FeaturesSection`                    | 86    | ✓      | **unused**          | Not imported by any page.                                                                                                                                                                                                                                                                        |
| `OrbitalFeaturesSection`             | 58    | ✓      | `/crm`              | `RadialOrbitalTimeline` of six capabilities on desktop; stacked cards on mobile. Each node carries a status of `completed` / `in-progress` / `pending`, surfaced as `פעיל` / `בפיתוח` / `בקרוב` — the marketing page labels two capabilities as not yet shipped.                                 |
| `HowItWorksSection`                  | 7     | ✓      | `/crm`              | Thin wrapper around `components/ui/how-it-works`, which owns `id='how-it-works'` — the anchor target for the hero's secondary CTA.                                                                                                                                                               |
| `StatsSection`                       | 36    | ✓      | `/crm`, `/features` | "ניהול לידים שהוא" + a `TextRotate` cycling מהיר / פשוט / חכם / יעיל / מדויק / נכון every 2s. Contains no statistics.                                                                                                                                                                            |
| `LeadSourcesSection`                 | 21    | ✓      | `/crm`              | `FeatureCarousel` on `#171424`.                                                                                                                                                                                                                                                                  |
| `TestimonialsSection`                | 19    | ✓      | `/crm` (lazy)       | `StaggerTestimonials` on `#0a0a0a`. The only `next/dynamic` import in the section.                                                                                                                                                                                                               |
| `FinalCTA`                           | 52    | ✓      | 8 pages             | Site-wide closer. `ParticleTextEffect` canvas rendering "SocialCRM" at `md+`; a gradient text headline below `md`. Copy: "תוך 5 דקות תוכל לייבא את הלידים שלך ולהתחיל לעבוד", buttons `התחל בחינם עכשיו` → `/auth` and `כל הפיצ׳רים` → `/features`, reassurance "ללא כרטיס אשראי. ללא התחייבות." |

### 7.3 Shared marketing UI (`components/ui/`, `components/marketing/`)

| Component                                                                                                           | Lines | Used by                              | Description                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MarketingNavbar`                                                                                                   | 159   | 7 pages (+ `/crm` via `HeroSection`) | White rounded bar, `max-w-6xl`. Logo → `/`. Six links at `lg+`; below that a hamburger opening a full-screen slide-over with body-scroll locking. `aria-label='ניווט ראשי'`.                        |
| `Footer4Col`                                                                                                        | 145   | all 13 (via layout)                  | Four columns on `#0a0a0a`: brand + legal-entity disclosure ("אלמיהו מקונן (עוסק פטור)"), פתרונות (5), משאבים (7), חברה (4), three social/email icons, and a bottom bar repeating three legal links. |
| `FAQ` (faq-tabs)                                                                                                    | 157   | 6 pages                              | Category tabs above an animated accordion list; `useState` for the selected tab. Renders `<h2>` from the `title` prop. Emits **no** id anchor.                                                      |
| `FeatureGrid` (feature-section)                                                                                     | 103   | 5 pages                              | Staggered-reveal grid of icon/title/bullets categories with a trailing CTA button.                                                                                                                  |
| `AnimatedCta`                                                                                                       | 140   | 7 pages                              | Full-bleed `#0a0a0a` band, `min-h-[55vh]`/`85vh`, giant `clamp(2.5rem,7vw,5.5rem)` h2 split into `title` + `highlight`, one button.                                                                 |
| `CRMComparisonTable`                                                                                                | 165   | `/crm-vs-excel`                      | Category-filtered feature table with status badges per column.                                                                                                                                      |
| `MagnifiedBento`                                                                                                    | 199   | `/facebook-leads`, `/whatsapp-leads` | Interactive bento visual.                                                                                                                                                                           |
| `PricingPageComponent` (pricing-card)                                                                               | 450   | `/pricing`                           | Plans, toggle, AI-value, workflow comparison, FAQ. Largest single file in the section.                                                                                                              |
| `HeroSection` / `HeroContent` / `HeroScene` / `ChannelBadges`                                                       | —     | `/crm`, `/`                          | Archetype-A hero. `HeroSection` embeds `MarketingNavbar` itself.                                                                                                                                    |
| `ParticleTextEffect`, `TextRotate`, `StaggerTestimonials`, `FeatureCarousel`, `RadialOrbitalTimeline`, `HowItWorks` | —     | via sections                         | Animation/visual primitives.                                                                                                                                                                        |

### 7.4 Dead or orphaned components

Three SEO components ship but are imported by no page: `components/seo/Hero.tsx`,
`components/seo/sections/FeaturesSection.tsx`, and `FAQSection` from `components/seo/FAQ.tsx`
(only its sibling `buildFAQSchema` is used). `SectionHeader` from `sections/shared.tsx` is
likewise unused by pages. They represent an earlier convention that the hand-rolled heroes and
`faq-tabs` replaced.

---

## 8. Information Architecture

### 8.1 Nominal hierarchy (as declared in breadcrumb schema)

```
דף הבית  (/)
 ├── ניהול לידים מפייסבוק        (/facebook-leads)
 ├── CRM ללידים מאינסטגרם        (/instagram-leads-crm)
 └── CRM לוואטסאפ עסקי           (/crm-for-whatsapp-business)
```

Only three pages declare breadcrumbs. The other ten sit flat at the root with no declared parent.

### 8.2 Actual navigation hierarchy

**Navbar (6 of 13 routes):** `/crm`, `/features`, `/facebook-leads`, `/whatsapp-leads`,
`/crm-vs-excel`, `/pricing`. Absent: `/instagram-leads-crm`, `/crm-for-whatsapp-business`, all
legal pages, `/thank-you`.

**Footer (12 of 13 routes)** across three columns — the only place `/instagram-leads-crm` and
`/crm-for-whatsapp-business` appear in persistent chrome.

### 8.3 Internal link graph

| From ↓ / To →                | `/` | `/crm` | `/features` | `/fb` | `/wa` | `/ig` | `/wab` | `/vs-excel` | `/pricing` | `/auth` |
| ---------------------------- | --- | ------ | ----------- | ----- | ----- | ----- | ------ | ----------- | ---------- | ------- |
| `/` `/crm`                   | —   | —      | ✓           | —     | —     | —     | —      | —           | —          | ✓✓✓✓    |
| `/features`                  | —   | ✓      | —           | —     | —     | ✓     | ✓      | ✓           | —          | ✓✓✓✓    |
| `/facebook-leads`            | —   | ✓      | ✓           | —     | —     | ✓     | ✓      | ✓           | —          | ✓✓✓✓    |
| `/whatsapp-leads`            | —   | —      | ✓✓          | —     | —     | ✓     | ✓      | ✓           | —          | ✓✓✓✓    |
| `/instagram-leads-crm`       | —   | —      | ✓           | —     | —     | —     | —      | —           | —          | ✓✓✓     |
| `/crm-for-whatsapp-business` | —   | —      | ✓           | —     | —     | —     | —      | —           | —          | ✓✓✓     |
| `/crm-vs-excel`              | —   | —      | ✓✓          | —     | —     | —     | —      | —           | —          | ✓✓✓✓    |
| `/pricing`                   | —   | —      | —           | —     | —     | —     | —      | —           | —          | ✓       |
| legal ×3                     | —   | —      | —           | —     | —     | —     | —      | —           | —          | —       |

_(navbar and footer links excluded — they are constant across pages; `✓✓✓✓` denotes the repeated
`/auth` CTA density described in 4.3.)_

**Observations.** `/features` is the most-linked-to body target, reached from six pages plus every
`FinalCTA`. `/pricing` receives **zero** in-body links. `/crm-vs-excel` receives three "ראה גם"
links but sends none back to the channel pages. Archetype-C pages receive links but emit almost
none, making them graph sinks.

### 8.4 The "ראה גם" pattern

Three pages carry a dark related-links strip: `/features`, `/facebook-leads`, `/whatsapp-leads`.
All three link to the same rotation of `/crm-for-whatsapp-business`, `/instagram-leads-crm`,
`/crm-vs-excel`. `/crm-vs-excel` is archetype B but has no such block; archetype-C pages have none
by design.

### 8.5 Anchor targets

`components/ui/how-it-works.tsx` declares `id='how-it-works'`. The hero secondary CTA on `/crm`
(`href='#how-it-works'`) and the footer link `/crm#how-it-works` both resolve.

The footer also links `/crm#faq`. **No element in the codebase declares `id='faq'`** — the
`faq-tabs` `FAQ` component renders a `<section>` with no id. That link lands on `/crm` without
scrolling.

---

## 9. Data Flow

### 9.1 There is almost none

No marketing page queries a database, calls an API during render, or invokes a server action for
its content. Every string is a literal in the page module or in the component it renders.

```
page module constants (faqItems, STATS, featureCategories, ROWS, …)
        │
        ├──► buildPageMetadata()  ──► Next.js <head>
        ├──► buildFAQSchema() / webPageSchema() / breadcrumbSchema()
        │             └──► <JsonLd> ──► inline <script>
        └──► JSX ──► static HTML
```

### 9.2 The three exceptions

1. **`MarketingNavbar`** calls the server action `getSessionState()` from `actions/auth` in a
   `useEffect` on mount, storing the result in `authed`. It also renders a `<form action={logout}>`
   in the mobile drawer for authenticated visitors.
2. **`/thank-you`** awaits `searchParams` and renders `title` / `description` from the query string.
3. **`/pricing`** navigates to `/api/payments/upgrade` on Pro selection. That route (not this
   section) performs auth, annual-link gating, `pending_upgrades` upsert, analytics, and the
   redirect to the payment provider.

### 9.3 Navbar authentication state

`MarketingNavbar` accepts an `isAuthenticated` prop defaulting to `false`. **No page passes it.**
The CTA is computed from that prop:

```tsx
const cta = isAuthenticated ? { text: 'פתח את האפליקציה', href: '/' } : { text: 'התחל בחינם', href: '/auth' }
```

The `authed` state fetched from `getSessionState()` is used **only** to conditionally render the
logout button in the mobile drawer. The consequence in the current build: a logged-in visitor
browsing marketing pages always sees "התחל בחינם" pointing at `/auth`, while the mobile menu
simultaneously offers them "התנתק".

### 9.4 Shared constants

`lib/pricing.ts` is the single source for prices (`PRICING.monthly = 89`, `PRICING.annual = 588`,
`ANNUAL_SAVINGS`, `ANNUAL_DISCOUNT_PERCENT`). `/pricing` reads from it. No other marketing page
displays a price; the schema `Offer` nodes hardcode `price: '0'`.

---

## 10. Metadata & Structured Data

### 10.1 Global metadata

`app/layout.tsx` exports `metaData` from `types/vars.ts`, which sets: `metadataBase` (from
`APP_URL`), title, description, icons (`/media/fav.svg`), `applicationName`, `manifest`,
`appleWebApp`, `formatDetection.telephone: false`, a full `openGraph` block, `twitter`
(`summary_large_image`), and `verification.google`. `types/vars.ts` also exports a
`resolveBaseUrl()` helper honouring `APP_URL` / `NEXT_PUBLIC_APP_URL` / `VERCEL_ENV` /
`VERCEL_URL`, falling back to `http://localhost:3000`.

### 10.2 Per-page metadata

All 13 pages call `buildPageMetadata()` (`lib/seo/metadata.ts`). It is a pure function producing:

| Field                   | Source                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `title`, `description`  | caller                                                                                                    |
| `alternates.canonical`  | `canonical ?? SITE_URL + path`                                                                            |
| `openGraph.title`       | `ogTitle ?? title`                                                                                        |
| `openGraph.description` | `ogDescription ?? description`                                                                            |
| `openGraph.url`         | the canonical URL                                                                                         |
| `openGraph.siteName`    | `'SocialCRM'`                                                                                             |
| `openGraph.locale`      | `'he_IL'`                                                                                                 |
| `openGraph.type`        | `'website'`                                                                                               |
| `openGraph.images`      | one 1200×630 `image/png` at `https://getsocialcrm.com/media/og.png`, absolute, with `secureUrl` and `alt` |
| `twitter`               | `summary_large_image` mirroring the OG title/description/image                                            |
| `robots`                | only when `noindex: true` → `{ index: false, follow: false }`                                             |

The absolute OG image URL is deliberate; the file comments that WhatsApp/Facebook/Twitter crawlers
fetch `og:image` exactly as declared with no base resolution.

No page uses `generateMetadata`. Every page's metadata is static.

### 10.3 JSON-LD architecture

**Two authoring styles coexist.**

_Shared helpers_ — `lib/seo/schemas.ts` exports five builders, all using a module-local
`SITE_URL = 'https://getsocialcrm.com'`:

| Builder                                   | `@id`            | Emitted by                                           |
| ----------------------------------------- | ---------------- | ---------------------------------------------------- |
| `organizationSchema()`                    | `/#organization` | `(marketing)/layout.tsx` — every page                |
| `softwareApplicationSchema()`             | `/#software`     | `(marketing)/layout.tsx` — every page                |
| `websiteSchema()`                         | `/#website`      | `(marketing)/layout.tsx` — every page                |
| `webPageSchema({path,title,description})` | the page URL     | `/instagram-leads-crm`, `/crm-for-whatsapp-business` |
| `breadcrumbSchema(items)`                 | —                | `/instagram-leads-crm`, `/crm-for-whatsapp-business` |

The three global nodes cross-reference correctly: `websiteSchema.publisher` and
`softwareApplicationSchema.publisher` both point at `/#organization`, and `webPageSchema.isPartOf`
points at `/#website`, which the layout does emit on every page.

_Inline literals_ — `/crm`, `/facebook-leads`, `/whatsapp-leads`, `/crm-vs-excel` hand-write their
`WebPage` / `SoftwareApplication` / `HowTo` objects with the domain typed out per property.

**`@id` collision.** `/crm` (and therefore `/`) emits a page-level `SoftwareApplication` with
`@id: 'https://getsocialcrm.com/#software'` — the identical `@id` the layout already emits from
`softwareApplicationSchema()`. Two nodes share one identifier on the same document, differing in
`url` (`/crm` vs `/`), `description`, `alternateName` and `featureList`.

**Breadcrumb inconsistency.** `/facebook-leads` nests its breadcrumb _inside_ the `WebPage` node as
a `breadcrumb` property; the two archetype-C pages emit a standalone `BreadcrumbList` node. Both
are valid schema.org; they are simply different conventions in the same section.

**FAQ coverage.** Six pages emit `FAQPage`. `/pricing` renders a visible FAQ (`PricingFAQ`) and
emits none. On five of the six, the schema array and the rendered tabs are slices of the same
source. `/crm` is the exception (see 6.2).

### 10.4 Sitemap

`app/sitemap.ts` returns a hand-written array of 11 entries against
`const BASE_URL = 'https://getsocialcrm.com'`. Every entry sets
`lastModified: new Date()` — evaluated at generation time, so all 11 URLs always report the same
"just modified" timestamp. `changeFrequency` is `'monthly'` for the eight content pages and
`'yearly'` for the three legal pages. Priorities: `/` 1.0, `/pricing` 0.9, `/features` and
`/facebook-leads` 0.85, `/whatsapp-leads` and `/crm-vs-excel` 0.8,
`/crm-for-whatsapp-business` and `/instagram-leads-crm` 0.7, legal 0.3.

The list is maintained by hand; nothing derives it from the route tree or asserts the two stay in
sync.

### 10.5 Robots

`app/robots.ts` returns one rule for `userAgent: '*'`, `allow: '/'`, with 11 disallowed prefixes:
`/auth/`, `/clients/`, `/dashboard/`, `/leads/`, `/tasks/`, `/settings/`, `/sum_sales/`, `/api/`,
`/files/`, `/promotion/`, `/thank-you`. Sitemap declared as
`https://getsocialcrm.com/sitemap.xml`.

Application routes that exist but are **not** listed: `/admin`, `/activate`, `/billing/`,
`/calendar`, `/deals`, `/inbox`. A previous static `public/robots.txt` was deleted in commit
`4bd04ce4` when this route handler was introduced.

### 10.6 Other crawl surfaces

- **`public/llms.txt`** — 129 lines of Hebrew/English product description for AI crawlers:
  entity definitions (ליד, CRM, סטטוס ליד), lead-status vocabulary, positioning. Its
  `**URL**:` field reads `https://socialcrm.vercel.app`, a preview host, not the production domain
  used everywhere else in the section.
- **`public/manifest.json`** — name, Hebrew description, `start_url: '/'`, `display: standalone`,
  `background_color: '#232032'`, `theme_color: '#3f20f5'`, `lang: 'he'`, `dir: 'rtl'`, and a single
  icon entry: `/media/fav.svg`, `sizes: 'any'`, `purpose: 'any maskable'`.
- **Search Console verification** — declared twice: `verification.google` in `types/vars.ts` and a
  static `public/google381898bf1aaede03.html`.
- **`next.config.mjs`** — no redirects, no rewrites, no `trailingSlash` setting. Security headers
  apply to `/:path*`; `poweredByHeader: false`.

---

## 11. Shared Design Patterns

### 11.1 Colour language

| Token             | Hex                                                     | Role                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand purple      | `#3f20f5`                                               | Every primary CTA, badges, underline flourishes, `theme_color`. Hardcoded as an inline `style` on most CTAs rather than via the `bg-solid` token the product app uses. |
| Near-black        | `#0a0a0a`                                               | `MarketingLayout` background, stats strips, "ראה גם" blocks, `AnimatedCta`, footer, testimonials.                                                                      |
| Deep purple-black | `#0a0812`                                               | `FinalCTA` only.                                                                                                                                                       |
| Dark card         | `#111111`, `#141414`                                    | Stat cards, mobile orbital cards.                                                                                                                                      |
| Ink               | `#171424`                                               | `LeadSourcesSection` background; `SectionHeader` title colour.                                                                                                         |
| Hero blue         | `bg-blue-50` + blue-400/600/700 shapes                  | Archetype-B hero backdrop.                                                                                                                                             |
| Channel accents   | `#1877F2` Facebook, `#25D366` WhatsApp, `#217346` Excel | Hero badge per page.                                                                                                                                                   |

Colour is applied through inline `style={{ backgroundColor: … }}` far more often than through
Tailwind tokens — a notable divergence from the product app, where `claude/ux-guidelines.md` §9
requires colour to carry meaning through the shared token set.

### 11.2 The archetype-B hero

Four absolutely-positioned blue shapes (a gradient overlay, a rotated square, a corner block, a
skewed panel) behind `MarketingNavbar` and a white `rounded-xl shadow-2xl` panel containing:
badge → h1 (two lines, `<br/>`) → sub-paragraph → dual CTA (outline secondary, solid purple
primary). This block is duplicated verbatim across `/features`, `/facebook-leads`,
`/whatsapp-leads`, `/crm-vs-excel`, `/instagram-leads-crm`, `/crm-for-whatsapp-business` — six
copies of the same ~25 lines of JSX, differing only in badge colour and copy.

### 11.3 The stats strip

Three cards on `#0a0a0a`, each a large value, a bold label and a muted sub-line. Present on
`/facebook-leads`, `/whatsapp-leads`, `/crm-vs-excel`, and both archetype-C pages, each with its
own local `STATS` constant. Recurring values: `×3` more leads closed, `0` leads forgotten, and a
page-specific time figure (`5 דק׳`, `10 שנ׳`).

Note the name collision: this hand-rolled strip is unrelated to `StatsSection`, the rotating-word
component, which contains no statistics at all.

### 11.4 Section rhythm

Pages alternate dark and white bands: dark hero-adjacent strips, white feature grids, dark CTA,
white FAQ, dark final CTA. `FAQ` (faq-tabs) is always white; `AnimatedCta` and `FinalCTA` are
always dark.

### 11.5 Motion

`motion/react` throughout. `FadeIn` (opacity + 28px rise, `once: true`, `-60px` margin) wraps
section headers. `FeatureGrid` uses staggered children. `StatsSection` runs a 2s-interval word
rotation. `FinalCTA` runs a particle canvas at `md+`. `RadialOrbitalTimeline` and
`StaggerTestimonials` animate on interaction.

No component in the section checks `prefers-reduced-motion`, which
`claude/frontend-experience-guidelines.md` §18 requires of product UI.

### 11.6 CTA copy patterns

Primary labels are verb-first and page-specific: `התחל בחינם`, `התחל בחינם עכשיו`,
`חבר את הפייסבוק שלך עכשיו`, `חברו את הוואטסאפ בחינם`, `עוברים למערכת בחינם`,
`התחל לנהל לידים בחינם`. Secondary labels are lateral and educational: `קרא עוד על ניהול לידים`,
`ראה איך זה עובד`, `ראה את כל הפיצ׳רים`, `כל הפיצ׳רים`, `איך זה עובד`.

Reassurance copy appears only in `FinalCTA`: "ללא כרטיס אשראי. ללא התחייבות."

---

## 12. UX Analysis

Objective observations against the questions posed, per page. These describe the current
experience; they are not a brief.

### 12.1 Per-page assessment

**`/` and `/crm`**

- _Trying to accomplish:_ establish the product category and the core promise.
- _Most important information:_ the h1 "כל ליד. במקום אחד. בלי לפספס." and the three channel badges above it.
- _Primary action:_ "התחל בחינם" → `/auth`. _Secondary:_ "איך זה עובד" scroll anchor.
- _Communicates purpose:_ yes — the h1 states the promise in six words.
- _Coherent top-to-bottom story:_ promise → capability → mechanism → proof → sources → social proof → conversion. The one break is `StatsSection`, a rotating-adjective banner ("ניהול לידים שהוא מהיר/פשוט/חכם…") sitting between the mechanism and the sources; it asserts qualities without evidence.
- _Five-second understanding:_ "A place where all my leads from Facebook, Instagram and WhatsApp land, so none get lost."

**`/features`**

- _Trying to accomplish:_ answer "does it do X?"
- _Most important information:_ the six feature categories.
- _Primary:_ `/auth`. _Secondary:_ `/crm`.
- _Communicates purpose:_ yes — badge "הפיצ׳רים" plus an explicit h1.
- _Coherent story:_ hero → six categories → CTA → rotating stats → FAQ → related → CTA. The `StatsSection` placement after the CTA interrupts the capability argument.
- _Five seconds:_ "Here's the full feature list, and it's free to start."

**`/facebook-leads`**

- _Trying to accomplish:_ prove the Facebook connection is automatic.
- _Most important information:_ the h1 "כל ליד מפייסבוק נכנס לבד" and the `5 דק׳` setup stat.
- _Primary:_ "חבר את הפייסבוק שלך עכשיו" → `/auth` — the most specific CTA in the section. _Secondary:_ `/crm`.
- _Communicates purpose:_ yes; the Facebook-blue badge and Lead Ads wording orient instantly.
- _Coherent story:_ claim → quantified proof → visual → capability → conversion → objections → siblings.
- _Five seconds:_ "Connect Facebook once and leads arrive by themselves."

**`/whatsapp-leads`**

- _Trying to accomplish:_ convert WhatsApp chaos into managed leads.
- _Most important information:_ "כל שיחה בוואטסאפ הופכת לליד מנוהל".
- _Primary:_ "חברו את הוואטסאפ בחינם". Note the `AnimatedCta` mid-page reverts to the generic "התחל בחינם עכשיו", so the page's specific promise is not carried through all five CTAs. _Secondary:_ `/features`.
- _Communicates purpose:_ yes.
- _Coherent story:_ structurally identical to `/facebook-leads`.
- _Five seconds:_ "My WhatsApp conversations become tracked leads."

**`/crm-vs-excel`**

- _Trying to accomplish:_ give a spreadsheet user permission to switch.
- _Most important information:_ the 16-row comparison table.
- _Primary:_ "עוברים למערכת בחינם". _Secondary:_ `/features`.
- _Communicates purpose:_ yes — the framing is explicit in badge, h1 and sub-paragraph.
- _Coherent story:_ the strongest in the section. Claim → three stats → the table that substantiates them → what replaces Excel → objections (cost, migration, timing) → conversion. The FAQ directly answers the switching objections rather than restating features.
- _Five seconds:_ "Excel is fine for storage but not for selling, and here's the proof."

**`/crm-for-whatsapp-business`** and **`/instagram-leads-crm`**

- _Trying to accomplish:_ meet a visitor who already has a partial tool and name what is missing.
- _Most important information:_ the "הסיטואציה הזו מוכרת?" pain-point section — these are the only pages that lead with the reader's problem before the product.
- _Primary:_ `/auth`. _Secondary:_ hero lateral link.
- _Communicates purpose:_ yes.
- _Coherent story:_ problem → evidence → solution → capability → conversion. The most conventional landing-page narrative in the section.
- _Five seconds:_ "They understand my exact situation and there's something that fixes it."
- _Note:_ `/instagram-leads-crm` states a capability limit plainly (Instagram DMs cannot be read by external systems; they are added manually). This is the section's clearest instance of accuracy over promise.

**`/pricing`**

- _Trying to accomplish:_ convert an evaluator.
- _Most important information:_ what is free versus what Pro adds.
- _Primary:_ the two plan CTAs. _Secondary:_ the billing toggle.
- _Communicates purpose:_ yes.
- _Coherent story:_ plans → why Pro → what changes → objections.
- _Five seconds:_ "Free to start; Pro adds the AI layer."
- _Note:_ the only page reached from the navbar but from no page body, and the only content page with no structured data.

**Legal pages**

- _Trying to accomplish:_ satisfy a compliance or curiosity lookup.
- _Most important information:_ the specific clause the visitor came for.
- _Primary action:_ **none.** These pages have no CTA and no navbar.
- _Communicates purpose:_ yes — h1 plus "עודכן לאחרונה".
- _Coherent story:_ flat sequential clauses; no hierarchy or table of contents.
- _Five seconds:_ "This is the privacy policy / terms / deletion process."
- _Note:_ a visitor landing here from search finds no navigation into the product except the footer.

**`/thank-you`**

- _Trying to accomplish:_ confirm an action succeeded.
- _Most important information:_ the success message.
- _Primary action:_ **none** — no CTA returns the visitor anywhere.
- _Five seconds:_ "The thing I did worked."

### 12.2 Cross-cutting observations

1. **One destination, many doors.** Every page funnels to `/auth`, repeated up to five times per page. Nothing in the section routes to `/pricing` from a body CTA.
2. **Purpose is stated, not implied.** Every content page opens with a coloured badge naming the topic and an h1 stating the claim in two lines. The 5-second test passes on all nine content pages.
3. **Secondary CTAs are lateral, never regressive.** They move the visitor sideways to another marketing page rather than deeper into a funnel step.
4. **Proof density varies sharply.** `/crm-vs-excel` substantiates its claims with a 16-row table; the channel pages assert `×3` and `0` in stat strips with no sourcing; `StatsSection` asserts adjectives with nothing at all.
5. **Terminal pages have no exits.** Legal pages and `/thank-you` present no path onward besides the footer.
6. **Repeated stat values.** `×3 יותר לידים נסגרים` and `0 לידים שנשכחים` appear on four pages with different sub-captions attributing them to different causes.

---

## 13. Storytelling Analysis

### 13.1 The three narrative shapes

**Shape A — capability-first (`/`, `/crm`, `/features`).**
Promise → what it does → how it works → proof → convert. The product is the protagonist; the
reader's problem is implied by the promise rather than dramatised.

**Shape B — claim-and-substantiate (`/facebook-leads`, `/whatsapp-leads`, `/crm-vs-excel`).**
Specific claim → quantified stats → a visual or table that substantiates → capability →
objections → convert. `/crm-vs-excel` is the fullest expression: the table is genuine evidence for
the headline.

**Shape C — problem-first (`/crm-for-whatsapp-business`, `/instagram-leads-crm`).**
"הסיטואציה הזו מוכרת?" → recognition → stats → "איך SocialCRM משלים…" → capability → convert. The
reader is the protagonist; the product enters as resolution.

### 13.2 Where the story holds

- The channel pages maintain a single controlling idea from badge to final CTA (Facebook: _it arrives by itself_; WhatsApp: _the conversation becomes a lead_).
- `/crm-vs-excel` earns its conclusion: the comparison table is the argument, not decoration, and the FAQ answers the objections switching actually raises (cost, data migration, timing).
- Shape C pages establish emotional recognition before proposing anything, which matches the emotional reality documented in `claude/product.md` §3.

### 13.3 Where the story breaks

- **`StatsSection` interrupts.** A rotating adjective banner ("ניהול לידים שהוא מהיר / פשוט / חכם…") sits mid-narrative on `/crm` and after the CTA on `/features`. It advances no argument and provides no evidence, and its name implies statistics it does not contain.
- **CTA promise drift.** `/whatsapp-leads` opens with "חברו את הוואטסאפ בחינם" and then offers "התחל בחינם עכשיו" in its `AnimatedCta` — the specific promise dissolves into a generic one before the close.
- **The homepage tells `/crm`'s story.** Because `/` re-exports `/crm`, the head-term landing page runs the "what is lead management" narrative rather than one written for the head term.
- **Two endings on some pages.** Archetype-B pages close with `AnimatedCta`, then FAQ, then "ראה גם", then `FinalCTA` — the visitor is asked to convert, then asked to read, then offered exits, then asked to convert again.
- **`OrbitalFeaturesSection` narrates the roadmap.** Two of its six nodes are labelled `בפיתוח` and `בקרוב`, placing unshipped capability inside the persuasion sequence on the homepage.
- **Terminal silence.** Legal pages and `/thank-you` end the story with no next step.

### 13.4 Voice

Consistent Hebrew, second-person plural or impersonal, short declaratives, concrete nouns
(ליד, נציג, סטטוס, מקור). The product terminology rules in `claude/ux-guidelines.md` §6 hold
throughout: `ליד`/`לידים` and `נציג` are used, `לקוח` and `סוכן` never appear as product terms.
One naming exception: the three legal pages call the product "SocialCRM Platform" while everything
else says "SocialCRM".

---

## 14. Design Consistency

### 14.1 What is consistent

- **One metadata path.** All 13 pages use `buildPageMetadata`; no page hand-writes an OG tag.
- **One canonical rule**, with one deliberate override (`/crm` → `/`).
- **One OG image** (1200×630 PNG) and one Twitter card type across the section.
- **One footer** on every route.
- **One conversion destination** (`/auth`).
- **One brand colour** for primary action (`#3f20f5`).
- **One FAQ renderer** (`faq-tabs`) on all six pages that show an FAQ.
- **One terminology set**, compliant with the product's Hebrew rules.
- **One motion library** (`motion/react`) and one reveal pattern (`FadeIn`).

### 14.2 What is inconsistent

| Dimension          | Variants in the section                                                                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero construction  | `HeroSection` (A) vs. the duplicated blue-panel block (B, C) — six verbatim copies                                                                                                                                   |
| Navbar presence    | 7 pages embed it; `/crm` gets it via `HeroSection`; `/pricing` renders it bare on white; 4 pages have none                                                                                                           |
| Page background    | `MarketingLayout` `#0a0a0a` on 10 pages; white on `/pricing`; unstyled on `/thank-you`                                                                                                                               |
| Schema authoring   | shared helpers (2 pages) vs. inline literals (4 pages) vs. none (5 pages)                                                                                                                                            |
| Breadcrumbs        | nested in `WebPage` (`/facebook-leads`) vs. standalone `BreadcrumbList` (archetype C) vs. absent (10 pages)                                                                                                          |
| `WebPage` node     | present on 4 pages, absent on `/features` and `/pricing`                                                                                                                                                             |
| Related links      | "ראה גם" on 3 pages only                                                                                                                                                                                             |
| Stats strip        | hand-rolled `STATS` const duplicated on 5 pages                                                                                                                                                                      |
| Colour application | inline `style` hex on marketing pages vs. Tailwind design tokens (`bg-solid`, `text-dark`) in the product app                                                                                                        |
| Product name       | "SocialCRM" everywhere except three legal pages ("SocialCRM Platform")                                                                                                                                               |
| Domain constant    | `SITE_URL` redefined in `lib/seo/metadata.ts`, `lib/seo/schemas.ts`, `app/sitemap.ts`, `app/robots.ts`, and inline in four page modules — while `types/vars.ts` exports an env-aware `baseUrl` that none of them use |

### 14.3 Relationship to the product app's design system

The marketing section and the product app are visually and structurally distinct:

|                | Marketing section                                                                                     | Product app                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Colour         | inline hex (`#3f20f5`, `#0a0a0a`)                                                                     | Tailwind tokens (`bg-solid`, `text-dark`)                     |
| Buttons        | `Btn` with heavy `className` overrides + inline `style`                                               | `Btn` variants as designed                                    |
| Cards          | bespoke per section                                                                                   | `rounded-lg border border-gray-200 bg-white p-6`              |
| Motion         | scroll reveals, particles, orbital timelines, rotating text                                           | minimal, purposeful (`frontend-experience-guidelines.md` §18) |
| Reduced motion | not handled                                                                                           | required                                                      |
| File sizes     | 5 pages exceed the 250-line soft limit; 3 exceed the 350-line hard limit (`architecture-rules.md` §1) | enforced                                                      |

`claude/architecture-rules.md` applies "to all existing files when they are touched." Pages over
the hard limit today: `/instagram-leads-crm` (322), `/crm-for-whatsapp-business` (317),
`/facebook-leads` (314). Over the soft limit: `/whatsapp-leads` (285), `/features` (248, at the
line), `/crm-vs-excel` (237), plus `components/ui/pricing-card.tsx` (450).

---

## 15. Technical Notes

Facts a redesign would need to know, stated without recommendation.

1. **`/` is a re-export of `/crm`.** Editing `/crm`'s component changes the homepage. The two files
   share one tree and differ only in metadata.
2. **Duplicate `@id`.** `/crm` and the marketing layout both emit a `SoftwareApplication` node with
   `@id: https://getsocialcrm.com/#software`, with different `url` and `description` values, on the
   same document.
3. **`/crm` FAQ schema and rendered FAQ differ.** The 8-item `faqItems` array feeds the schema; a
   separate 12-question inline object feeds the visible tabs.
4. **`/pricing` emits no structured data** despite a visible FAQ and being the commercial page.
5. **Footer anchor `/crm#faq` has no target.** No element declares `id='faq'`.
   `/crm#how-it-works` does resolve (`components/ui/how-it-works.tsx:71`).
6. **`MarketingNavbar`'s CTA never reflects the session.** `cta` derives from the `isAuthenticated`
   prop, which no page passes; the `authed` state from `getSessionState()` gates only the mobile
   logout button.
7. **`public/llms.txt` names `https://socialcrm.vercel.app`** as the site URL, a preview host,
   while every other surface uses `getsocialcrm.com`.
8. **`robots.ts` omits six existing routes** — `/admin`, `/activate`, `/billing/`, `/calendar`,
   `/deals`, `/inbox`.
9. **Sitemap `lastModified` is `new Date()`** for all 11 entries, so every URL reports the same
   generation-time freshness.
10. **The sitemap is hand-maintained.** Nothing derives it from the route tree; a new marketing
    route is not added automatically.
11. **`SITE_URL` is redefined in at least eight places** while `types/vars.ts` exports an
    env-aware `baseUrl`.
12. **Four components ship unused:** `components/seo/Hero.tsx`,
    `components/seo/sections/FeaturesSection.tsx`, `FAQSection` (from `components/seo/FAQ.tsx`),
    and `SectionHeader`.
13. **`manifest.json` declares one SVG icon** with `purpose: 'any maskable'` and no PNG sizes.
14. **No `prefers-reduced-motion` handling** anywhere in the section.
15. **No error boundary** is defined for the `(marketing)` route group.
16. **The blue-panel hero is duplicated verbatim six times** rather than extracted.
17. **`/thank-you` renders unescaped query parameters** as its `title` and `description`, and still
    receives the layout's three JSON-LD graphs and footer despite being `noindex`.
18. **`components/seo/MarketingLayout.tsx` is not a Next.js layout** — it is a manually-imported
    background wrapper, and `/pricing` and `/thank-you` skip it.

---

## 16. Future Expansion Points

Where the current architecture has room, and what each would touch. Descriptive, not prescriptive.

**Adding a keyword page.** The archetype-C pattern (`/instagram-leads-crm`) is the most complete
template: module-level `PAGE_PATH`/`PAGE_TITLE`/`PAGE_DESCRIPTION` constants feeding both
`buildPageMetadata` and `webPageSchema`, plus `breadcrumbSchema` and `buildFAQSchema`. A new page
would additionally need a manual `app/sitemap.ts` entry, a decision on navbar inclusion (the bar
holds six links today), a footer column entry, and inclusion in the "ראה גם" rotation.

**Blog / content marketing.** `marketing-knowledge/content-ideas.md` §"Blog posts (SEO-targeted
Hebrew)" already plans Hebrew posts mapped to existing routes (notably B1 feeding
`/crm-vs-excel`). No blog route, no `Article`/`BlogPosting` schema, no author or date metadata, and
no dynamic-route sitemap generation exist yet — a blog is the first expansion that would break the
hand-maintained sitemap.

**Navigation capacity.** Two content routes (`/instagram-leads-crm`,
`/crm-for-whatsapp-business`) already live outside the navbar, reachable only from the footer and
three "ראה גם" blocks. Any further cluster page inherits that constraint.

**Structured-data coverage.** `Product`/`Offer` on `/pricing`, `FAQPage` on `/pricing`, and
`WebPage` on `/features` are the gaps in the current graph. `lib/seo/schemas.ts` already has the
shape for the last of these.

**Localisation.** Everything is `he-IL`, RTL, hardcoded. There are no `alternates.languages`, no
`hreflang`, and no locale routing. `lib/seo/metadata.ts` sets `locale: 'he_IL'` as a constant.

**Conversion instrumentation.** `/pricing` passes `source=marketing_pricing` to the upgrade route,
which records intent and fires analytics. No other marketing CTA carries a source parameter, so
`/auth` arrivals are not attributable to a landing page.

**Design-system convergence.** The section's inline-hex, bespoke-component approach diverges from
the product app's token-and-primitive system. `claude/architecture-rules.md` §10 already records a
deliberate exception for marketing brand glyphs (`components/ui/hero/scenes/PlatformIcon.tsx`,
`ChannelBadges.tsx`) which must **not** be unified with the app's `MetaLeadAdsBadge`. Any
convergence work would need to respect that documented boundary.

---

## Appendix A — File map

| Concern                    | Path                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Route group layout         | `app/(marketing)/layout.tsx`                                                                                               |
| Pages                      | `app/(marketing)/*/page.tsx` (13)                                                                                          |
| Metadata builder           | `lib/seo/metadata.ts`                                                                                                      |
| Schema builders            | `lib/seo/schemas.ts`                                                                                                       |
| Global metadata object     | `types/vars.ts`                                                                                                            |
| JSON-LD renderer           | `components/seo/JsonLd.tsx`                                                                                                |
| FAQ schema builder         | `components/seo/FAQ.tsx`                                                                                                   |
| Background wrapper         | `components/seo/MarketingLayout.tsx`                                                                                       |
| Section barrel             | `components/seo/CRMSections.tsx` → `components/seo/sections/*`                                                             |
| Navbar                     | `components/marketing/MarketingNavbar.tsx`                                                                                 |
| Footer                     | `components/ui/footer-column.tsx`                                                                                          |
| Marketing UI kit           | `components/ui/{faq-tabs,feature-section,animated-cta,crm-comparison-table,magnified-bento,pricing-card,how-it-works}.tsx` |
| Hero (archetype A)         | `components/ui/hero/{HeroSection,HeroContent,HeroScene,ChannelBadges}.tsx`                                                 |
| Sitemap                    | `app/sitemap.ts`                                                                                                           |
| Robots                     | `app/robots.ts`                                                                                                            |
| AI crawler brief           | `public/llms.txt`                                                                                                          |
| PWA manifest               | `public/manifest.json`                                                                                                     |
| Search Console             | `public/google381898bf1aaede03.html` + `verification.google` in `types/vars.ts`                                            |
| Prices                     | `lib/pricing.ts`                                                                                                           |
| Upgrade route (referenced) | `app/api/payments/upgrade/route.ts`                                                                                        |

## Appendix B — Route-to-cluster quick reference

| Route                        | Cluster     | Archetype | Navbar | Footer | Breadcrumb | FAQ schema | WebPage schema |
| ---------------------------- | ----------- | --------- | ------ | ------ | ---------- | ---------- | -------------- |
| `/`                          | head term   | A         | logo   | —      | —          | ✓          | —              |
| `/crm`                       | generic CRM | A         | ✓      | ✓✓✓✓   | —          | ✓          | —              |
| `/features`                  | capability  | B         | ✓      | ✓✓     | —          | ✓          | —              |
| `/facebook-leads`            | Facebook    | B         | ✓      | ✓✓     | nested     | ✓          | ✓              |
| `/whatsapp-leads`            | WhatsApp    | B         | ✓      | ✓      | —          | ✓          | ✓              |
| `/instagram-leads-crm`       | Instagram   | C         | —      | ✓      | standalone | ✓          | ✓              |
| `/crm-for-whatsapp-business` | WA Business | C         | —      | ✓      | standalone | ✓          | ✓              |
| `/crm-vs-excel`              | Excel       | B         | ✓      | ✓      | —          | ✓          | ✓              |
| `/pricing`                   | commercial  | F         | ✓      | —      | —          | —          | —              |
| `/privacy`                   | legal       | D         | —      | ✓✓     | —          | —          | —              |
| `/terms`                     | legal       | D         | —      | ✓✓     | —          | —          | —              |
| `/data-deletion`             | legal       | D         | —      | ✓✓     | —          | —          | —              |
| `/thank-you`                 | utility     | E         | —      | —      | —          | —          | —              |
