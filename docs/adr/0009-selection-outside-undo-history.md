# ADR 0009: Selection outside undo history

- Status: Accepted
- Date: 2026-09-24
- Scope: R6 Code map, exploration tabs (ordinary and Changes modes)

## Context

Per-tab undo/redo (`explorerJourney.ts`) currently snapshots the whole journey, so inspecting
a resource, clearing inspection and changing the multi-selection (`multiIds`) each occupy an
undo entry. `docs/STABLE_GRAPH_INTERACTIONS.md` §"Exploration tabs" documents this, and
`scripts/test-explorer-journeys.mjs` pins it (for example "one user action restores scope,
inspection and tree together").

In practice selection is a pointer, not an exploration edit: clicking through ten cards to read
their inspectors fills ten undo slots, and Ctrl/Cmd Z then walks back through clicks instead of
the last real change (movement, expansion, scope). The outgoing relation stack
(`docs/OUTGOING_STACK.md`) makes this worse. Its root stays pinned while the user clicks through
chain cards, so selection churn becomes the normal way of using it.

Fullscreen, the Map overview disclosure and the zoom buttons already live outside history as
`TRANSIENT_UPDATE`s that are applied to `present`, `past` and `future` alike.

## Decision

1. **Selection is transient per-tab state.** This covers the inspected subject
   (`inspectedSubjectId` / `inspectedKind` / `inspectedOccurrenceId` / `inspectedLevel`) and the
   multi-selection (`multiIds`). Changing them never creates, occupies or merges into an undo
   entry. Undo/redo leaves the current selection in place; it is not restored from the history
   entry being stepped to.
2. **Prune after undo/redo.** If the restored map no longer displays the inspected resource,
   a multi-selected card, or the outgoing-stack root, that reference is dropped. This reuses the
   `revalidateJourney.ts` pruning rules. An inspected edge whose route no longer exists is also
   dropped.
3. **Inspector Back navigation is unchanged.** `NAVIGATE_BACK` / `view.history` is an explicit
   "previous inspected" trail, not undo. It keeps its own entries and its current behavior.
4. **Double-click-to-arrange is one undo entry for the arrangement only.** Click 1 (inspect) no
   longer seals an undo step, so the `UPDATE { collapse: true }` special case and its gesture-window
   bookkeeping are removed. Undo reverts the arrangement and leaves the selection as it is.
5. **Selection changes that come with a real edit still record that edit.** For example, removing
   a selected card from scope records the scope change; the selection changes transiently
   alongside it.

## Consequences

- Undo/redo only walks exploration edits: scope, geometry, expansion, level, filter, source-dialog
  open/close and camera navigation as already documented.
- `STABLE_GRAPH_INTERACTIONS.md` §"Exploration tabs" and the Escape paragraph are updated.
  Journey tests that assert selection restoration are rewritten to assert the opposite, and a test
  is added for pruning a selection that points at a card removed by undo.
- Clone tab still copies the current selection. Reopen closed tab restores the tab's current
  selection (pruned against the current graph).
- Implementation note: selection currently lives inside `Journey.view` (the reducer state), not
  beside it. Undo/redo must therefore carry the *current* selection fields into the restored
  `view`, rather than moving them out of the reducer. This keeps `explorerViewState.ts` invariants
  intact (for example, `inspectedLevel` is non-null exactly when `inspectedSubjectId` is non-null).

## Implementation notes (2026-09-24)

- `journeysReducer` classifies each `UPDATE`. When one changes only selection fields
  (`inspected*`, the Back trail `history`, `multiIds`), it replaces `present` and nothing
  else, so there is no entry, no merge and no redo loss. The fields a click changes alongside
  selection (tree reveal, search reset, mobile pane) are also allowed. On their own they are
  still recorded. App issues each selection gesture as one update so the whole gesture
  classifies together.
- `UNDO`/`REDO` carry the current selection into the restored entry. Then
  `revalidateJourney.pruneRestoredSelection` drops an inspected card, an inspected route or
  multi-selected cards that the map drew before the step and does not draw after it. App
  passes `graphFor`, so "drawn" includes children of expanded cards. Without a graph the
  view's own displayed record is used. Crossing a Changes toggle revalidates the carried
  selection the same way a mode switch does.
- Back is unchanged as navigation. `NAVIGATE_BACK` keeps the existing level view when
  reconciliation leaves it identical. A Back that only changes the inspected subject
  therefore classifies as a selection change and adds no undo entry, while one that drops
  ineligible cards is still recorded.

## Implementation notes: review remediation (2026-09-24)

- Undo/redo pruning also filters the carried Back trail. A card entry is dropped when the
  card was drawn before the step and is not after it. A route entry follows the inspected
  route's rule. Level-only breadcrumbs and subjects that were never drawn stay.
- When either side of the step has no graph, route knowledge is unavailable. An aggregate
  route (`aggregate:[source,target,...]`, parsed by `graphModel.aggregateRouteEndpoints`
  beside its builder) then counts as gone when one of its endpoint cards was drawn before and
  is not after. A raw relationship ID (unresolved target) names no card and is never pruned
  this way.
- Pruning is skipped when nothing is selected or trailed, and when the step left mode, scope,
  level, displayed IDs and expansions reference-identical. Route sets are built only when a
  route is inspected or in the Back trail. Behavior is otherwise unchanged.
- `priorEligibleIds` is admission bookkeeping, not display. `NAVIGATE_BACK` still refreshes
  it, but the journey's selection-only classification compares level views with
  `explorerViewState.sameDisplayedLevelView`, which ignores that field. A Back that only
  refreshes it therefore adds no undo entry. `NAVIGATE_BACK` still reuses the level view
  object when nothing at all changed, so identity-based consumers (the initial-camera capture)
  keep matching.

## Implementation notes: outgoing stack root (2026-09-24)

- `Journey.outgoingStackRootId` (docs/OUTGOING_STACK.md) is classified and carried like selection.
  Changing it adds no entry, `UNDO`/`REDO` carry the current value, and `pruneRestoredSelection`
  drops it when the root was drawn before the step and is not after.
- Unlike selection, the root is also pruned after ordinary `UPDATE`s and `REVIEW_RECAPTURED`
  (`revalidateJourney.pruneStackRoot`, using the action's `graphFor`), because the stack must end
  whenever its root leaves the map. Selection keeps its pointer semantics and is still pruned only
  by undo/redo and by mode or recapture revalidation.
