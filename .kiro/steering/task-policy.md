---
inclusion: always
---

# Working policy for stsht/s

Standing rules for any task in this repo. Don't re-derive or re-ask these.

## Primary goal
- Keep the website lightweight and keep it functional while we iterate on the go.
- Every change should be incremental and safe: never ruin code unrelated to the task.
- When in doubt between "more thorough" and "smaller/safer footprint", choose smaller and safer.

## Git / delivery
- Work on `main`. Commit and push directly to `main` unless I explicitly ask for a branch or PR.
- Start from latest `main`. Record `git rev-parse HEAD` + `git status --short` at preflight.
- Final report (keep it short): commit hash, changed files, 1-line summary, validation results, and whether any process was left running.

## Scope discipline
- Minimal, focused patches only. Change nothing outside the stated task.
- Do not refactor large files just because they are large. Patch big files (7K-10K lines) in place; only extract when a tiny, clearly-safe extraction is justified. Ask before any broad file split/refactor.
- Preserve unless the task explicitly says otherwise: data model, routing, UI behavior, styling system, mobile behavior, API payload shapes (`/api/save`), slug/password output, clipboard behavior, localStorage/sessionStorage behavior, CSS class names, and user-facing text.

## Protected paths (do not touch unless the task explicitly targets them)
- `src/pages/invcs/**`
- `src/pages/g/**`
- `*.css`
- `_worker.js`
- `*.sql` / schema files
- DB helper files
- `src/components/WorkspacePanels.jsx`

## Skip setup (no exceptions unless I ask)
- No `npm install`, `npm audit`, dependency repair, or Playwright/browser install.
- No dev servers, watchers, or background/long-running processes (`control_bash_process` / `run_in_background`). Never leave a process alive after finishing; stop any started for this repo.
- No heavy builds or test suites unless required to verify the task or I ask. If deps are missing, report "build skipped".

## Validation (lightweight, targeted)
- Lean by default: do the minimum checks that prove the specific change works.
- `git diff --check` + focused `rg`/static checks on changed files.
- `node --check` on changed `.js` files.
- Heavy verification (before/after fixtures, byte-identical proofs, full rebaseline scans) only when I ask for it OR when an edit must be behavior-preserving (e.g. extracting/moving code where output must stay identical).

## Token & time economy
- Read each file once; trust what's already been read. Don't re-read or re-list.
- Prefer targeted `rg`/grep over reading whole large files; read narrow ranges for huge files.
- Batch independent shell commands into a single call; run independent tool calls in parallel.
- Don't echo large file contents into chat unless I need to see them.
- No narration or filler. Report only what I asked for.
- Don't re-run commands whose result is already known (e.g. repeat `git status`).
- Deep analysis of very large files may be delegated to another tool/model. When I'm given the relevant excerpt or conclusion, trust it and act on targeted reads instead of scanning the whole file myself.


## Report format (use for every task)
Write for a non-coder. Keep it short, scannable, plain-language. Use this shape:

- **Status:** Done / Needs you / Blocked
- **What changed:** 1-2 lines, plain English (no jargon)
- **Files:** `path/name` - one line each on what changed
- **Commit:** `<hash>` "<message>"
- **Pushed to main:** yes/no
- **Checks:** passed / what failed
- **Notes:** risks or follow-ups, or "none"

No narration before or after unless I ask a question. Skip technical detail unless I request it.


## Cleanup status
- `/l` lane: CLOSED (fully extracted as of Pass 73). Do not propose further `/l` extractions.
