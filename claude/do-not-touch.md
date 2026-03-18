# do-not-touch.md — Protected Systems & Hard Boundaries

## 1. CRITICAL SYSTEMS

The following must **NEVER** be modified without an explicit instruction that names them directly:

- **Authentication** — Google login flow, session handling, token management
- **Permissions** — `user_perms` table and all logic that reads from it
- **transferSales** — the logic that handles lead transfers and commission updates across multiple tables
- **Database schema** — all tables, columns, types, and relations
- **Core server actions** — any server-side function that writes to or reads from the DB

If a task does not explicitly mention one of these systems — do not touch them.

---

## 2. DATABASE RULES

These rules apply to all tables, at all times:

- **Never rename a column** — existing queries and API responses will break
- **Never delete a column** — data will be lost and queries will fail
- **Never change a column type** — silent data corruption or runtime errors
- **Never remove a table** — dependent joins and queries will break
- **Never modify a foreign key or relation** — cascading failures across the UI

If a schema change is needed, it must be requested explicitly with a migration plan. No improvisation.

---

## 3. API & DATA FLOW RULES

- Do not change the shape of data returned from server actions or API routes
- Do not rename fields in server responses — components depend on exact field names
- Do not change the order of operations in data fetching logic
- Do not remove fields from a response even if they appear unused — they may be consumed elsewhere
- Do not refactor shared data-fetching logic without full knowledge of all consumers

---

## 4. HIGH-RISK AREAS

| Area                           | Why it's dangerous                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| **Authentication**             | A mistake can lock all users out of the system immediately                                    |
| **Permissions (`user_perms`)** | Controls what each user can see and do — a bug silently breaks visibility or commission logic |
| **transferSales**              | Writes to multiple tables in sequence — partial failure leaves data in a corrupt state        |
| **DB joins**                   | A broken join returns wrong or empty data with no visible error — the UI silently fails       |

These areas have no safe "quick fix". Any change requires full understanding of the system.

---

## 5. SAFE VS UNSAFE CHANGES

### SAFE — can be done freely:

- Changing UI text, labels, and placeholders
- Updating styles, spacing, colors
- Reordering elements on a page
- Adding helper text, tooltips, or empty states
- Adding new UI-only components that don't touch data

### UNSAFE — requires explicit instruction and review:

- Any backend logic or server action
- Any change to the database or migration files
- Renaming variables, props, or fields tied to API responses
- Refactoring shared hooks, utilities, or context providers
- Anything that touches auth, permissions, or transferSales

When in doubt — it's unsafe.

---

## 6. WHEN UNSURE

If you are not 100% certain that a change is safe:

→ **DO NOT make the change**
→ **Ask for clarification before proceeding**

Guessing is not acceptable in a production system. The cost of a wrong change is higher than the cost of pausing to ask.

---

## 7. GOLDEN RULE

> **"If a change can break data, authentication, or permissions — do not touch it."**

No exceptions.
