---
inclusion: fileMatch
fileMatchPattern: ['src/components/PrivateWorkspaceFrame.jsx', 'src/components/PrivateWorkspaceFrame.css', 'src/pages/invcs/InvoiceComposer.jsx', 'src/pages/invcs/invcs.css']
---

# Workspace shell vs /inv composer shell

`PrivateWorkspaceFrame` (used by /db, /l, /subs) and the /inv
`InvoiceComposer` shell are **two deliberately-parallel implementations
of the same canvas**, not one shared component. They are already
unified at the primitive level:

- both render `GlobalBackground` inside a `scroll-root` page,
- both use the `scroll-surface-y` utility for panel scrolling,
- `PrivateWorkspaceFrame.css` is documented as mirroring the /inv
  classes 1:1 (`.composer-page → .pf-page`, `.editor-panel → .pf-panel--left`,
  `.preview-panel → .pf-panel--right`, `.panel-header → .pf-header`,
  `.mode-switch → .pf-pillset`, `.mobile-tabs → .pf-mobile-tabs`),
- `--panel/--line/--soft/--field/--ink/--muted/--shadow` are **defined in
  `invcs.css`** and consumed by `PrivateWorkspaceFrame.css`.

## Do NOT migrate /inv onto PrivateWorkspaceFrame as a quick change

`PrivateWorkspaceFrame`'s component API is already sufficient for /inv
(`showNav={false}`, an arbitrary `pills` node for the invoice/deposit/paid
`.mode-switch`, a `right` panel, `mobileTabs`) — **no prop addition is
required**. The blocker is purely CSS:

- `invcs.css` keys ~50 rules (plus their descendant form / sheet /
  totals / deposit selectors) to `.composer-*` / `.editor-panel` /
  `.preview-panel` / `.panel-header` / `.mode-switch` / `.mobile-tabs`.
  Re-pointing the JSX to `pf-*` classes would orphan all of those and
  change invoice visuals.
- /inv's mobile toggle uses a `show-preview` class on `.composer-shell`
  with `mobileView` of `'edit' | 'preview'`, whereas the frame uses
  `data-show-detail` with `'left' | 'right'`.
- The preview panel owns its own action toolbar + the `documentRef`
  invoice sheet that `html2canvas` rasterises; it does not fit the
  frame's "right = single node wrapped in `.pf-panel-scroll`" contract
  without restructuring export-critical markup.

## Prerequisite for a future migration (separate, scoped task)

1. First consolidate the design tokens out of `invcs.css` into a shared
   stylesheet both shells import (so the token dependency is no longer
   one-directional).
2. Then migrate /inv class-by-class with visual diffing, keeping
   `InvoiceComposer` business logic and the `documentRef` export path
   untouched.

Until then, keep the two shells in sync by editing both when changing
shared shell behavior (sizing, sticky header, mobile toggle, scroll
model).
