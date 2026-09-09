# ADR 0003: Hierarchical explanation generation

- Status: Accepted
- Date: 2026-09-09
- Scope: R6 Explain all and on-demand context propagation

> The single-turn and oversized-input-failure policy below is superseded by
> [ADR 0004](0004-bounded-architecture-batches.md). Other hierarchy decisions remain.

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
