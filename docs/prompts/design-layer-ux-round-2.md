# Handoff prompt: design-layer UX, round 2

Paste the text below into a new session.

Continue on branch `claude/wizardly-meitner-rekrqx` (already pushed; it holds the design layer from
ADR 0014). Develop, commit and push on this same branch. Do not open a PR unless I ask.

### Before any work
- Read CLAUDE.md and AGENTS.md (binding), and PROJECT_STATUS.md (the "Design layer" entry at the top).
- Read docs/adr/0014-design-layer.md, docs/ARCHITECTURE.md §5 and §8, and
  docs/STABLE_GRAPH_INTERACTIONS.md.
- Read the code you will change:
  - frontend/src/features/design/: designModel.ts, designExchange.ts, DesignEditorDialog.tsx,
    DesignSection.tsx
  - frontend/src/features/explorer/: GraphCanvas.tsx, nodeCard.ts, graphModel.ts,
    explorerViewState.ts, explorerJourney.ts, expansionLayout.ts
  - frontend/src/App.tsx (design section: refreshDesign, RECONCILE_ALL, designCommand, exportBrief,
    importBrief, openLayoutTab)
  - src/main/java/dev/codeatlas/design/ (DesignService, DesignExchangeService, AgentGuide, DesignKeys)
  - api/DesignController.java
- Then run a short grilling round with me (the `grilling` skill, installed in `.claude/skills/`; if it
  is missing, reinstall from mattpocock/skills per skills-lock.json). Confirm the open decisions
  listed at the end, give your recommendation for each, and wait for my answers before coding.

### What I want

1. **Add inside expanded containers, in design mode.**
   - When a package card is expanded with Design on, its box always keeps a little extra empty space
     (one card slot) at the end.
   - Hovering the expanded package shows a "+ class" button in that space.
   - An expanded class does the same with a "+ method" button.
   - Use the existing corner-button/overlay mechanism in GraphCanvas.tsx (cornerButtons/cornerHit,
     DOM overlays). Keep the geometry in the pure layout layer (expansionLayout.ts /
     placementGeometry.ts), not ad hoc in GraphCanvas.

2. **Instant inline creation.** Clicking that button, or choosing an "Add …" item from the right-click
   menu (card menu or empty-canvas "Add package"):
   - immediately creates the card where it will live;
   - puts keyboard focus in its title, so what I type next becomes the package, class or method name
     (inline edit on the card, no modal);
   - Enter commits (one putResource change set);
   - Esc, or blur with an empty name, cancels and removes the card.
   - Show an inline error on the card if the server rejects the name.
   - For methods, typing `name(Type, Type)` sets the parameter types (reuse parseParameterTypes in
     designModel.ts).
   - Remove the toolbar "+ Add" button.

3. **Relations by direct manipulation, in design mode.**
   - Hovering any card (package, class or method, parsed or designed) shows a small relation handle.
   - Click the handle, then click the target card: two clicks, no drag needed.
   - Between the two clicks, a dashed violet line follows the mouse from the source.
   - Esc, or clicking empty canvas, cancels.
   - On the second click, create the relation (putRelation) and open the intent popover from item 4 on it.
   - Drawing the rubber-band line belongs on the existing direction-overlay canvas in GraphCanvas, or a
     sibling overlay. Never add Cytoscape elements for it.

4. **Double-click in design mode.**
   - Double-click no longer runs "arrange around this resource" when Design is on (keep the inspector's
     Arrange button).
   - Instead, open a small popover anchored just above and to the right of the card, to create or edit
     its explanation, intent first.
   - The same popover is used for relations: right after creating one, and on double-click of a
     designed route. It also lets me change the relation kind.
   - With Design off, double-click keeps today's arrange behaviour.

5. **A separate "Prompt" button**, next to Export. Export stays the full, importable brief. The prompt
   is for handing work to an AI coding agent:
   - It contains only designed things:
     - authored resources: PLANNED, and IMPLEMENTED with a note;
     - designed relations;
     - every explanation (intention) attached to any resource or relation, parsed code included. An
       intention on an existing class may say its behaviour must change.
   - Include the minimal parsed context needed to locate each item: the key, kind, parent chain, and
     the signature where known.
   - State the relation semantics explicitly. A designed relation `A -KIND-> B` with intention X means:
     the engineer wants A (or code inside A) to call / implement / inject / … B or a sub-resource of B,
     for reason X. The agent must implement that relation in its code change.
   - Each resource's intention is a requirement to implement. An intention on existing code is a
     requested behaviour change.
   - End with a short "how to report back" section (the change-set API from AgentGuide). Keep it
     concise. No parsed dependency dump, no JSON import block unless you recommend it in the grilling
     round.
   - Backend: a new endpoint, e.g. `GET|POST /api/workspaces/{id}/design/prompt`, rendered in the
     `design` module, with a unit/integration test.
   - The UI copies the prompt to the clipboard and also offers a download.

6. **Toggling Design must not move designed cards.**
   - Turning Design off and on again shows every designed card exactly where it was: positions, sizes,
     and positions inside expanded containers.
   - Exception: its parent package or class was meanwhile moved or collapsed. Then it re-enters at its
     parent's new place or default layout.
   - Today, RECONCILE_ALL drops their geometry when they become ineligible. Fix this at the right layer:
     park `design:` IDs' geometry while hidden, as the Changes overlay parks review-only IDs
     (parkedIds / isParkedId in explorerViewState.ts). Pin it with a pure test in
     scripts/test-explorer-view-state.mjs or a new test.

### Constraints
- Keep the ADR 0014 invariants:
  - design items are never parser facts;
  - parsed code accepts only explanations;
  - design edits stay outside undo history;
  - with Design off, and in the Changes overlay, behaviour is unchanged.
- Respect the layering in CLAUDE.md:
  - pure reducer and layout helpers → journey → App → the GraphCanvas adapter;
  - copy renderer inputs, never alias them.
- Record the decisions as an amendment to ADR 0014, or as ADR 0015 if the double-click change counts as
  a deviation from STABLE_GRAPH_INTERACTIONS.md. Update ARCHITECTURE.md §8, TESTING.md, CLAUDE.md
  commands and PROJECT_STATUS.md (exact commands, pass/fail, what was not run and why).

### Verification
- Run: `./gradlew test`, `cd frontend && npx tsc -b --force && npm run build`, and every
  `node scripts/test-*.mjs`.
- Extend `scripts/verify_design_layer_pipeline.py` / `verify-design-layer-ui.mjs` to cover:
  - hover "+ class" in an expanded package, then type a name and press Enter;
  - "+ method" with `name(Long)`;
  - Esc cancel;
  - two-click relation with the rubber-band line visible mid-gesture (screenshot it);
  - the double-click popover in design mode, and arrange still working with Design off;
  - Prompt contents: only designed items, the relation semantics text, and an intention on parsed code
    present;
  - toggling Design off and on, asserting identical cy positions for design cards.
- Use `CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Inspect every screenshot and copy the evidence to `docs/evidence/design-layer-ux/`.
- Also re-run the change-edges, ungroup and git-review pipelines. The stable-graph acceptance pipeline
  was already failing before this branch (stale `.segmented` level switcher; see PROJECT_STATUS); say so
  if it still fails.

### Open decisions to settle in the grilling round (give your recommendation for each)
a. The kind of a relation created by two clicks: default CALLS and changeable in the popover, or pick
   the kind before the second click?
b. Where the hover relation handle sits on a card, given the existing code/details/stack corner
   buttons, and on expanded boxes.
c. A new card created inline but not yet committed: a local draft card, or create on the server first
   with a placeholder name?
d. Prompt scope: whole workspace or the current tab's scope? Should IMPLEMENTED designed items appear
   (as "verify"), or only PLANNED items plus intentions?
e. Should the Prompt include the JSON block for round-tripping, or stay prose-only?
f. Does the "Design" toggle stay a per-viewer preference (current) now that positions must survive
   it, or become per-tab state?
