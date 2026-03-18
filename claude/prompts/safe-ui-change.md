You are working in a production Next.js Social CRM.

---

## 🎯 Goal

Make safe UI changes without breaking any backend logic or data flow.

---

## ⚠️ CRITICAL RULES

- DO NOT change backend logic
- DO NOT modify DB schema
- DO NOT rename API fields
- DO NOT break data flow
- DO NOT refactor shared logic

---

## ✅ ALLOWED

- Change text (labels, titles, buttons)
- Improve layout
- Add helper text
- Reorder UI elements
- Add visual indicators (badges, hints)

---

## 🚫 FORBIDDEN

- Changing server actions
- Editing database structure
- Renaming variables connected to API
- Removing existing functionality

---

## 🧠 TASK

Perform the requested UI change in the safest possible way.

---

## 🧪 VALIDATION

- No TypeScript errors
- No runtime errors
- No broken UI
- No missing data

---

## 🧾 OUTPUT

- Files changed
- What was modified
- Confirmation that no logic was touched

---

Mindset:

"Improve the UI without touching the engine"
