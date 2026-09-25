# Outgoing stack review — 2026-09-24

Reviewed commit `04cd34e` against its parent, the outgoing-stack specification,
and ADRs 0007–0009. Scope: R6 step 12 phase B, traversal, pinned state, and
canvas presentation. This is a review, not implementation acceptance or remediation.

## Finding

- **P2 — Give every layer-zero card root emphasis.** In `GraphCanvas.tsx:687–688`,
  only `outgoingStackRootId` gets `stack-root`, while `stack-member` is restricted
  to `layers`. For an expanded root, visible descendants are in `rootSet` and
  deliberately absent from `layers`, so they receive neither outline. Apply
  `stack-root` to the root set; keep the pressed toggle restricted to the pinned
  root. Add browser coverage for an expanded root, including nested descendants.

No additional confirmed defect was found in the reviewed changes.

## Evidence and limits

- `for t in scripts/test-*.mjs; do node "$t" >/dev/null || exit 1; echo "PASS $t"; done`:
  PASS, all 12 suites.
- From `frontend`, `npx tsc --noEmit --incremental false -p tsconfig.json`: PASS.
  An initial attempt with `-p tsconfig.app.json` failed because that file does not exist.
- Inspected committed `docs/evidence/outgoing-stack/03-chain-card-expanded.png`:
  downstream expansion has numbered child cards; it does not exercise an expanded
  root. The browser script likewise expands a downstream card in that scenario.
- Browser acceptance, mutation checks, frontend production build, and backend
  checks were not rerun in this review. Existing implementation reports are
  historical evidence, not fresh verification. No application code was changed.
- `docs/BUILD_BRIEF.md` is absent; consulted `docs/BUILD.md`, identified as the
  original brief by ADR 0007.

## Resolution (2026-09-25)

- **P2 fixed.** `GraphCanvas.tsx` applies `stack-root` to every card in `rootSet`; the pressed toggle
  stays on the pinned root only. `scripts/verify-outgoing-stack-ui.mjs` expands the root package and
  a type inside it, then asserts that every layer-0 card (nested methods included) has the root look,
  no badge, no chain outline and no mute. Fresh isolated browser run: 55/55 PASS. Screenshot
  `docs/evidence/outgoing-stack/08-expanded-root.png` was inspected.
- The same follow-up also changed the traversal to parser facts at the root's granularity (user
  decision). See `docs/OUTGOING_STACK.md` §Traversal and the "Step 12 phase B follow-ups" entry in
  `PROJECT_STATUS.md`.
