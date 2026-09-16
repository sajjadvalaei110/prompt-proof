# ADR 0003: Hierarchical explanation generation

- Status: Accepted
- Date: 2026-09-09
- Scope: R6 Explain all and on-demand context propagation

> The single-turn and oversized-input-failure policy below is superseded by
> [ADR 0004](0004-bounded-architecture-batches.md). Other hierarchy decisions remain.
>
> The edge-aggregate sparkle rule below ("only if all of their occurrences are READY") is
> superseded by [Amendment 1](#amendment-1-edge-aggregate-sparkle-is-any-occurrence) at the end of
> this record. The original text is retained unchanged as the decision as it was taken.

## Decision

Explain all includes active `CLASS` and `METHOD` symbols only. Interfaces, records,
enums, fields, constructors and relationship occurrences remain available through
on-demand requests. In particular, relationships are never newly queued by bulk work.

A durable job-level synthesis barrier precedes individual requests. One structured
architecture turn receives the complete package tree, type IDs/names/stereotypes,
package coupling grouped by kind/resolution, and every project document. The model
returns every CLASS exactly once. Local validation rejects malformed, missing,
duplicate, foreign or non-CLASS IDs and empty/oversized purposes. It saves the whole
set atomically or saves none. No extra synthesis repair turn is issued; existing
provider transport fallback for unsupported `response_format` remains unchanged.

`explanation_syntheses` records schema/prompt version, endpoint/model, input
fingerprint, retained context evidence and freshness. `class_pre_explanations`
associates each class with its current synthesis and inferred purpose. Drafts do not
occupy full explanation slots and never count as READY coverage. Prior synthesis
inputs and successful full outputs remain retained. Document edits stale both.

Queue order is `(incoming occurrence count + outgoing occurrence count ASC,
physical declaration lines ASC, symbol ID ASC)`. Repeated calls and unresolved
outgoing occurrences count; a self-loop counts once in each direction. LOC is the
largest retained declaration span, including blank/comment lines. Missing spans
sort last among equal-degree symbols. This is the requested coupling heuristic,
not a topological sort or a promise that every method precedes its class.

Execution is sequential, including retries. The legacy concurrency request parameter
remains accepted for API compatibility but does not increase dispatch concurrency.
This policy guarantees actual request/completion order and maximizes propagation;
cycles never cause recursive generation. Explicit clicks retain priority 100,
although a symbol already belonging to a bulk job still waits for its barrier.

The same context builder serves bulk and on-demand requests. Classes consume their
architecture draft, member method explanations and collaborator explanations;
methods consume their owner and both incoming/outgoing methods and their owners;
edges consume endpoint source and explanations plus exact occurrence evidence.
Full READY prose is preferred over drafts except for the class's own architecture
baseline. Stale prose is retained for inspection but excluded from new contexts.

Generated evidence blocks use `ai-` IDs and are explicitly untrusted interpretation.
They cannot be the sole basis for a SOURCE_FACT claim. Their original citations
are not promoted into the current context. Stored dependencies identify the exact
consumed versions; later independent outputs do not stale earlier work. Refreshing
a consumed output invalidates downstream consumers to a fixed point, including
cycles. Existing prose/evidence remains available after invalidation.

The global input is never truncated: oversized inventory/documents fail with an
actionable budget error. Individual contexts are bounded, share space across
related resources and disclose shortening/omission. Large outputs may require a
larger configured Output Budget; there is no model or endpoint fallback.

## Alternatives and consequences

A draft column on symbols would mingle generated prose with parser-owned facts
and lose shared synthesis provenance. Separate records keep that boundary explicit.
A synthetic queue item would pollute symbol coverage, so phase state belongs to
`jobs.synthesis_status` instead. Concurrent dispatch would improve throughput but
could race completion order and reduce available context, so this revision chooses
sequential processing as allowed by the product request.

V004 upgrades unfinished legacy work by skipping low-priority non-CLASS/METHOD
items and resetting the synthesis barrier; explicit edge clicks and successful
outputs remain intact. Cancellation permits an already-running request to finish,
retains its successful result and prevents further bulk dispatch. Restart recovers
abandoned items and synthesis. Resume reuses a matching fresh synthesis and skips
READY full explanations, including older prompt versions.

A shared native SVG sparkle indicates READY for any configured model; it does not
assert that Gemini generated the text. Edge aggregates sparkle only if all of their
occurrences are READY. Resolution color/dashing remains independent. The active
InspectorPanel handles class, method and edge views; legacy inspector placeholder
files are not part of the rendered application.

## Verification

`HierarchicalExplanationTest` exercises order, propagation, validation, cancellation,
resume/restart, document changes, generated-only citation rejection and consumed
input invalidation. `HierarchicalMigrationTest` verifies V003→V004 upgrade behavior.
The packaged Chromium smoke test uses an explicitly local mock provider and checks
61 bulk symbols, edge on-demand requests, READY badges, reduced motion and viewport
preservation. It does not establish live-model output quality.

## Amendment 1: edge-aggregate sparkle is "any occurrence"

- Status: Accepted
- Date: 2026-09-16
- Amends: the "Edge aggregates sparkle only if all of their occurrences are READY" rule above.

**Rule.** A merged edge is READY when **any** of its occurrences is READY. When none is, the
least settled status present wins: FAILED > STALE > QUEUED > NOT_REQUESTED.

**Why the original rule could not hold.** Explanations are requested per *occurrence*, and one
drawn line now merges every relationship between the same ordered (source, target) pair regardless
of kind. A CALLS occurrence almost always also carries the DEPENDS_ON derived from it, so
"every occurrence READY" made the badge effectively unreachable: explaining the call the user
actually clicked still left the derived occurrence unrequested, and the line never sparkled.

**Why the non-ready ordering matters.** The first implementation of the "any" rule collapsed any
disagreement among non-ready occurrences to NOT_REQUESTED, which silently erased FAILED and STALE —
a line whose explanation had failed rendered identically to one nobody had asked about, contradicting
AGENTS.md ("Keep uncertainty, partial analysis and failed explanations visible"). Ranking the
non-ready statuses keeps the worst one visible instead.

**Consequences.** The badge means "at least one occurrence of this line has a ready explanation",
not "this whole line is explained" — the inspector remains the place to see per-occurrence status,
and its occurrence dropdown is what distinguishes the two. Implemented in
`graphModel.ts` (`dominantExplanationStatus`, used by `aggregateEdges`); covered by
`scripts/test-graph-model.mjs` and by the canvas-badge assertion in `scripts/verify-hierarchical-ui.mjs`,
which asserts the sparkle while only the first occurrence is explained.
