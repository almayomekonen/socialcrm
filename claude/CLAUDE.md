# CLAUDE.md — Project Context

## 1. PROJECT OVERVIEW

- This is a **Social CRM**
- Used for managing leads sourced from social media
- Built with **Next.js**
- This is a **production system** — not a demo or prototype

---

## 2. CORE GOAL

The system must:

- Help users manage leads quickly
- Be understandable within **5 seconds**
- Drive user action within **10–20 seconds**

---

## 3. UX PRINCIPLES

- Clarity over complexity
- Action over features
- No confusing UI
- Every screen must guide the user toward a clear next step

---

## 4. CRITICAL RULES

- DO NOT break backend logic
- DO NOT modify DB schema
- DO NOT rename API fields
- DO NOT remove existing functionality
- DO NOT refactor unless explicitly asked

---

## 5. KEY USER FLOW

```
User logs in → sees empty state → uploads leads → sees leads → continues using system
```

---

## 6. TERMINOLOGY

**Use:**

- `לידים` (leads)
- `נציג` (agent/rep)

**Avoid:**

- Insurance terms such as `סוכן`

---

## 7. SENSITIVE AREAS

The following areas are **dangerous** — do not modify without explicit instruction:

- **Authentication** — Google login flow
- **Permissions** — `user_perms` logic
- **transferSales** — commission/transfer logic
- **DB joins** — any cross-table query logic

---

## 8. DECISION RULE

Before making any change, always ask:

1. Does this make the system **clearer**?
2. Does this help the user **act faster**?

If the answer to both is not yes → **do not implement.**

---

## 9. PRIORITY ACTIONS

The system must always prioritize:

1. Adding leads
2. Importing leads (Excel upload)
3. Viewing leads
4. Managing leads

Any UI or feature should support one of these actions.

---b

## 10. WHAT NOT TO BUILD

This system is NOT:

- Not an insurance system
- Not an enterprise ERP
- Not a complex multi-step workflow system

Avoid:

- Over-engineering
- Adding unnecessary features
- Creating complex flows when a simple action is enough
