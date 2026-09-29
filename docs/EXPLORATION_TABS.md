# Exploration tabs and history

R6 acceptance slice: developers can branch an exploration, return to its saved map,
and undo or redo exploration actions without changing another tab or server data.

## Behavior

- **New tab** starts from the loaded snapshot's initial view. **Clone tab** copies the
  current view and both history branches. Changes to either tab remain independent.
- Close preserves the ten most recently closed tabs for **Reopen closed tab**. The
  last open tab cannot close. Arrow keys, Home and End navigate the tab strip.
- **Undo** and **Redo** keep up to 200 actions per tab. Ctrl/Cmd Z undoes;
  Ctrl/Cmd Shift Z and Ctrl Y redo. Editable fields retain native text undo.
- Saved exploration state includes scope, displayed cards at each level, coordinates,
  sizes, expansions, pan/zoom, relationship filter, tree disclosures, search,
  source-dialog subject and navigation width.
- Selection is per-tab state outside history
  ([ADR 0009](adr/0009-selection-outside-undo-history.md)). This covers the inspected
  resource or route, its occurrence choice, the inspector's Back trail and the
  multi-selection. Changing selection never adds an undo entry or discards redo. A Back
  that also drops cards that are no longer eligible is recorded; otherwise it is only a
  selection change. The tree
  reveal, search reset and details pane that come with a click are part of the same
  gesture. Undo and redo keep the current selection, dropping only cards and routes that were
  on the map before the step and are not after it, from the Back trail too. A double-click is one arrangement entry;
  undoing it keeps the card inspected.
- Fullscreen, the **Map overview** disclosure and dedicated zoom
  buttons are view-only controls: they do not add history entries, and their current values
  stay in place when another exploration action is undone or redone. Wheel/pinch/pan and
  **Fit map** continue to record camera navigation.
- One dedicated zoom click now equals three former 1.2× steps: zoom in is 1.728× and zoom
  out is its reciprocal, both centered on the canvas.
- **Changes** switches the active tab's review presentation while keeping its current
  map arrangement. Both modes share scope, expansions, sizes and pan/zoom; moving a
  card in either mode carries that position into the other. The toggle is undoable.
- Selecting an inspected resource again, clicking empty canvas, **Clear selection**
  or Escape clears inspection and multi-selection. Escape first cancels an active
  menu, resize, marquee or source dialog. Clearing selection is not an undo action.

Tabs and history last for the current page session and snapshot. A reload or new
snapshot starts over. DOM scroll offsets, text selection, transient menus and
explanation disclosures are not saved. Native browser full screen depends on browser
permissions and gestures.

## Boundaries

Parser facts and explanations are shared current snapshot data, outside history.
Undo never reverses analysis, explanation jobs, model settings or document edits.
No additional model request is made by recording or restoring history. Source
dialogs and inspectors can fetch their existing source/evidence when restored.

Immutable journey values can be shared between histories and clones. Cytoscape
retains and mutates the position object passed to `add()`, so the adapter gives it
a copy. Otherwise expanding, resizing or dragging one tab silently corrupts the
coordinates saved by another tab and its undo history.

The initial fit records a baseline without adding an undo step. View-only changes are
rebased across both history branches so a later undo cannot incidentally change them.
Pending camera updates flush before pointer/keyboard actions and tab/history commands. Ordinary
Escape runs through one handler so clearing inspection and multi-selection stays
atomic. Browser full-screen ownership lives above the canvas lifecycle; undo and redo
never enter or exit full screen.

## Verification

Pure history and existing graph checks:

```sh
node scripts/test-explorer-journeys.mjs
node scripts/test-explorer-view-state.mjs
node scripts/test-graph-model.mjs
node scripts/test-expansion-layout.mjs
node scripts/test-node-card.mjs
node scripts/test-focused-arrangement.mjs
node scripts/test-graph-placement.mjs
node scripts/test-source-evidence.mjs
cd frontend && npm run build
```

`scripts/verify-explorer-journeys.mjs` uses Node's built-in WebSocket and Chromium
CDP, matching the existing browser harness. Start the backend with an isolated data
directory and no model profile, serve the production frontend with `/api` proxied
to that backend, and start a separate headless Chromium with remote debugging.
Pass a disposable copy of `test-fixtures/microservice-java`, not a private repository:

```sh
BACKEND=http://127.0.0.1:8095 APP=http://127.0.0.1:5198 \
  DEBUG=http://127.0.0.1:9333 \
  node scripts/verify-explorer-journeys.mjs /tmp/atlas-journey-fixture
```

The harness analyzes source through the real backend, exercises the production UI,
and saves a report plus desktop/mobile screenshots in `build/explorer-journeys/`.
It does not request generated explanations or establish live model integration.
Recorded outcomes and the retained evidence location are in `PROJECT_STATUS.md`.
