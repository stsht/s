STARSHOTS DESIGN CHECKPOINT — 2026-10-25 (V4 / GREETING FINISH)
==================================================================
Branch: experiment/greeting-name-animation-v1
Target: main
Previous delivery-surface polish: PR #157 — https://github.com/stsht/s/pull/157
This checkpoint now includes the greeting typography/name accent and the Version B color-burst experiment (PR #162).

DESIGN DECISIONS
- Keep the existing Plus Jakarta Sans stack; no new font dependency.
- Greeting weight changed from 600 to 500.
- Greeting letter spacing changed from -0.035em to -0.02em.
- Preserve responsive font sizing and 1.22 line height.
- Version B color-burst: the personalized name stays normal for 500ms, then makes a crisp vivid-blue entrance (#3978F6), softens to cornflower blue (#789BEA) at 700ms overall, and smoothly settles to the normal text color by 1500ms overall. This is a one-shot 1000ms color-only animation after a 500ms delay; greeting prefix remains stable.
- Applied consistently to the public delivery card greeting and the access-key gate greeting.
- Honor prefers-reduced-motion by disabling the color animation.
- No exclamation mark added; copy remains "Hello, [Title] [Client Name]".

FILES CHANGED
- src/pages/g/g.css — typography and keyframes/reduced-motion rule.
- src/pages/g/main.jsx — wraps only the existing personalized name in a styled span; displayed greeting text is unchanged.
- The pre-change CSS/JSX snapshots were temporary working-tree files. They
  have since been removed from the active tree; their Git objects remain
  recoverable from repository history.
- `docs/archive/2026-10-25-design-checkpoint.md` — this checkpoint.

SAFETY / VALIDATION
- Intent is styling only: no route, password/session/API, payment, invoice, upload, or delivery-link logic was intentionally changed.
- JSX greeting strings are preserved; only personalized name text is wrapped for styling.
- Source-level checks performed for exact replacement targets, single occurrences, balanced CSS braces, and presence of reduced-motion handling.
- Version B timing experiment: 500ms initial pause, then a vivid blue burst that softens by 700ms overall and eases back to normal by 1500ms overall. Pre-change CSS/JSX snapshots are recoverable from Git history; they are not
kept as duplicate working-tree files.
- A build, browser visual test, and live Cloudflare Pages deployment check have NOT yet been run. Review the branch preview in both light/dark modes before merging/deploying.
