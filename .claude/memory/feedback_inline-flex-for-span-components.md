---
name: inline-flex-for-span-components
description: Use inline-flex (not flex) on span elements inside table cells to prevent block-level layout breaking
type: feedback
---

Always use `inline-flex` on `<span>` containers inside table `<td>` cells, never `flex`.

**Why:** Using `flex` on a `<span>` promotes it to block-level inside the td, causing the content to stack vertically (e.g. a dot above a label instead of side by side). `inline-flex` keeps the element inline so all children stay on one line. Confirmed this fixed the FormatRank dot+label stacking bug.

**How to apply:** Any time a span needs flex layout inside a table cell or any inline context, default to `inline-flex` instead of `flex`.
