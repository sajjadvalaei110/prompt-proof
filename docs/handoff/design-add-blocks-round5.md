# Handoff: design add blocks, round 5 (three owner complaints)

Continue on branch `claude/wizardly-meitner-rekrqx` (pushed, HEAD `270bdcc`, clean apart from the owner's
untracked `docs/review/` and `docs/reviews/design-add-blocks-review.md`; leave those alone). Develop,
commit and push on this branch. Do not open a PR unless the owner asks.

## Before any work
- Read `CLAUDE.md` and `AGENTS.md`. They are binding:
  - design items are never parser facts;
  - design edits stay outside undo history;
  - with Design off and in Changes, behaviour is unchanged;
  - Cytoscape inputs are copied, never aliased;
  - geometry lives in the pure layer: `expansionLayout` / `placementGeometry` → journey → App →
    `GraphCanvas`, which only draws.
- Read `docs/adr/0014`–`0016` and `docs/adr/0017-design-add-blocks.md`, all three rounds.
- Read the top entries of `PROJECT_STATUS.md` (rounds 4, 4b and 4c) and
  `docs/reviews/design-add-blocks-review-response.md`. Verify claims against the code.
- Read `docs/ARCHITECTURE.md` §5 and §8, and `docs/STABLE_GRAPH_INTERACTIONS.md`.

## What exists now (short)
In design mode (Design on, Changes off):
- **Hover anywhere empty** inside an expanded package or class offers a "+ class" / "+ method" block under
  the pointer. `expansionLayout.addBlockAt` builds it over `freeRect`, an exact sweep of the maximal empty
  rectangles. Its corner snaps to an 8 px grid, it is at most a card and at least `DESIGN_LEAST_BLOCK`
  (220×150).
- **The created card takes the block's exact shape.** The draft is drawn at the block size. On commit, a
  pending growth keyed by card id (`takeAdmitted`) applies `RESIZE_RESOURCE` inside `RECONCILE_ALL`.
- **When no free space is left**, `designBlocks` returns `reserve`. This is a fixed 220×150 block placed by
  `designSlot`, where `placeMissingChildren` would put the next child: a new row at the box's **left**.
  - `placementGeometry.geometryForJourney` (lines ~70–76) grows the box to hold it (`slotMinSizes`).
  - Hovering inside that reserve only ever offers the reserve itself. The area outside the old inner box is
    not in `AddArea.inner`, so `addBlockAt` returns null there and `blockAt` falls back to the fixed
    `slots` list (`GraphCanvas.tsx`, `blockAt` / `hitAt`).
- **The draft** (`DesignDraftInput`, `GraphCanvas.tsx` ~line 1340) draws the outline at the block's stage
  rect. Its content is scaled by `Math.max(zoom, DRAFT_MIN_SCALE = 0.6)` (line 162 / 1346). The rejected-name
  error is an unscaled label under the outline.
- **Planned members are named `name(Type, …)`** on the map: `designModel.displayName` (`designModel.ts:68-72`).
  Imported (`origin: CODE`) members and parsed methods show just `name`.

## The three things to fix

### 1. A full box must grow so hover creation works there, not show the old bottom-left button
**Owner:** "when a package's last row is full the system extends the package, but in a way that hover class
creation doesn't work, and it falls back to the same old class creation button at the bottom left. Extend
the package size in a way that hover class creation works and does not need the bottom-left button. Same
for methods."

**Today:** with no gap, the box grows by one 220×150 block at the left of a new row, and only that exact
block is clickable.

**Wanted:** when no block fits, the box grows by a **growth band**: free space that the ordinary hover rule
covers, so "+ class" follows the pointer anywhere in it, exactly as in any other empty space. There is no
fixed bottom-left button.

Suggested design. Keep it in the pure layer, and record the decision as ADR 0017 "Round 4":
- In `designBlocks`, when `gaps` is empty, return a **growth region** in place of a fixed reserve block. It
  is a strip below the lowest child, `GAP` below it:
  - **width:** the box's current inner width, but at least one card width;
  - **height:** one card height (`card.height`, not `least`), so a full-size card fits anywhere along it.

  Consider whether a band to the **right** (one card wide, full inner height) suits a wide box better. Pick
  one rule, deterministically, and explain it in the ADR. The owner asked only that hover works and that
  there is no fixed button.
- **Hover:** extend the `AddArea` handed to the canvas, so `area.inner` covers the old inner box plus the
  band. Then `addBlockAt` works across the band with no special case. Check whether `slots`/`reserve` is
  still needed: the card menu "Add …" needs a default block, which could be the band's left part. The
  canvas fallback that offers only the fixed reserve should go.
- **Growth:** `geometryForJourney` (and `boxWithBlocks`, which `toggleExpand`, `resizeContainer` and
  `roomMoves` use through `RoomCard.blocks`) must grow the box to hold the band, right and down only, as
  today. All of them must keep using the one pure rule.
- **Stability.** Gaps are searched on the box *without* the band, so the band never counts as its own gap.
  After a card is created in the band:
  - if room is left in its row, gaps exist, the band goes, and the box stays as tall as the new card
    (card-height band means no shrink jump);
  - if no room is left, a new band appears below.

  Prove both with unit tests. Also check:
  - **narrow blocks:** a block in the band can be narrower than a card only where the band ends;
  - **empty box:** an empty box stays one card-sized block at its corner (ADR 0017 §F17). Decide whether an
    empty box should simply be "inner = one card area, hover anywhere in it" and keep it consistent;
  - **methods** in an expanded class: same rule, with method card sizes.
- **Room-making:** `makeRoomForGrowth` and `roomMoves` must still push neighbours when the box grows by a
  band, including nested boxes (ADR 0017 §5 / round 3).
- **Design off / Changes:** no band, no change, as now.
- **Tests:**
  - **Unit (`scripts/test-expansion-layout.mjs`):**
    - a full 2×2 grid yields a band whose `addBlockAt` succeeds at its left, middle and right;
    - a card made in the band leaves no band when room remains in its row;
    - the band appears again when that row fills;
    - a fuzz test: blocks inside the band never meet a child.
  - **Browser (`scripts/verify-design-layer-ui.mjs`):**
    - in the one-class audit package (step 2b: today "one reserve of 220×150"), hover at the **right** part
      of the grown area and create a class there;
    - assert its exact shape;
    - assert there is no `.design-slot` at the bottom-left unless the pointer is there;
    - assert the box does not grow further when room remains;
    - do the same for "+ method" in a full class.

### 2. The name-entry draft must stay inside the dashed area
**Owner:** "when creating a resource, after clicking create class, the box to enter the name is larger than
the dashed area, and it's larger than the package itself. It's bad UI."

**Cause:** `DesignDraftInput` scales the content by `max(zoom, 0.6)`. The usual fit zoom is about 0.55, so at
normal zoom the content almost always spills past the outline, and past the package.

**Wanted:** the draft, input included, sits **inside** the dashed block. Recommended approach:
- Render the content exactly at the block's shape, scaled by the true zoom with no minimum, so outline and
  content always coincide.
- If the block is too small on screen to type into (for example, the input would be under about 16 px
  tall), first move the camera to the block when the draft opens, so the draft is legible:
  - centre on it and zoom so the block is at least a readable size;
  - this is view-only state, outside undo (ADR 0009); use the camera path the canvas already has;
  - keep the user's zoom when it is already large enough.
- Keep the content's own layout compact enough to fit the smallest block (220×150 model px): kind line,
  input, hint. The hint may go first if there is no room.
- Render the rejected-name error **inside** the outline, replacing the hint, or as a small tooltip that
  doesn't cover the package. Decide one way and say why. It must not make the draft look bigger than the
  block.
- **Tests:**
  - the browser step that checks the outline equals the block must also check that the input's and
    content's client rects lie inside the outline, at normal zoom and at a far-out start zoom (with the
    camera move);
  - update step 2e's "zoomed out" check (`05f-draft-zoomed-out.png`) to the new behaviour;
  - inspect the screenshots.

### 3. Revert the `()` on planned method names
**Owner:** "'()' is being added to the method name, and it's inconsistent with other methods. Revert it."

**Cause:** `designModel.displayName` shows a planned member as `name(Type, …)`, so a no-argument method reads
`search()`. Parsed methods (and imported design members) show just `name`.

**Wanted:**
- Planned methods and constructors display just `name` on the map, like parsed ones.
- Keep the **key** unchanged (`Owner.name(Type,…)`): it is the stable identity used by the API, the
  export/import and agents.
- Parameter types stay where they are useful and consistent with parsed members: the inspector or popover
  signature, and the Prompt text (`DesignPromptService` already uses the signature). Check how parsed members
  show their signature in the inspector, and match that.
- **Check every consumer of a design member's `simpleName`:**
  - the card label (`nodeCard`);
  - the inline-error duplicate-key check (`commitInlineDraft` compares keys, which is fine);
  - the quick popup and popover titles;
  - the tree / NavigationPane;
  - search;
  - `test-design-model.mjs`;
  - the browser test, which waits for ids like `…search(String)`. Ids are keys and stay the same; only
    asserted *labels* change.
- **Overloads:** two planned `find(Long)` and `find(String)` will both read `find`, exactly as parsed
  overloads do. Note it in the ADR.

## Checks to run and record (PROJECT_STATUS, new top entry: exact commands, pass/fail, not run and why)
- `cd frontend && npx tsc -b --force && npm run build`
- every `node scripts/test-*.mjs`
- `./gradlew bootJar`, then with `CHROMIUM=/snap/bin/chromium`:
  - `python3 scripts/verify_design_layer_pipeline.py`: open and inspect every screenshot, then refresh
    `docs/evidence/design-layer-ux/` (screenshots, `report.json`, `design-prompt.md`);
  - `verify_change_edges_pipeline.py`, `verify_ungroup_pipeline.py` (expect 33/33) and
    `verify_git_review_pipeline.py`: the Design-off contract;
  - `verify_stable_graph_pipeline.py acceptance`: a known old failure at `revealClasses`, which predates this
    work. Confirm it is unchanged.
- `./gradlew test` only if backend code changes. #3 should not need any; if `DesignPromptService` changes,
  run `DesignLayerIntegrationTest`.

## Environment notes
- `/tmp` is a tmpfs with a per-user quota. On 2026-10-02, "Disk quota exceeded" there broke Chromium/CDP
  runs and made the ungroup pipeline hang. If browser runs hang or fail oddly:
  1. check `df -h /tmp`, and test a write;
  2. remove only this project's regenerable temp dirs (`/tmp/atlas-bounded-scale-*`,
     `/tmp/code-atlas-*fixture*`). Never remove other projects' files there.
- Chromium: `/snap/bin/chromium`. Pipelines take 2–10 minutes each; run long ones in the background.

## Docs to update
- ADR 0017: a new "Round 4" section covering the growth band, the draft fitting its block, and plain member
  names. Mark which earlier sections it supersedes (the fixed reserve, `DRAFT_MIN_SCALE`, `displayName`).
- `docs/ARCHITECTURE.md` §8 if a seam changes.
- `docs/TESTING.md`.
- `docs/reviews/design-add-blocks-review-response.md`: update F16 and F17 if their resolutions change.
- `CLAUDE.md`: only if the one-line design-mode summary becomes wrong.
