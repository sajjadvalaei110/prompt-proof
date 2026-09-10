# ADR 0005: Bounded explanation working sets

- Status: Accepted
- Date: 2026-09-10
- Scope: R6 architecture synthesis, Explain all, on-demand context, model I/O, and UI polling
- Supersedes: ADR 0004's in-memory planning and checkpoint-publication mechanics

## Problem

The resumable hierarchy in ADR 0004 bounded individual provider calls, but several
repository-sized objects still existed around those calls. Architecture preparation
loaded complete inventories and documents and retained all summaries and class
purposes. Explain all loaded every eligible subject before inserting the queue.
On-demand contexts fetched complete relationship/member/document result sets before
trimming them. The HTTP adapter let the JSON converter materialize an unbounded
provider body. Browser interval polling could overlap slow requests and continue
after useful work ended.

Reducing only the class batch size would leave those dominant allocations intact.
The working set must instead be a property of explicit limits, independent of the
number of indexed symbols, relationships, and document characters.

## Decision

`ArchitectureBatchProcessor` is the deep boundary for architecture preparation. Its
public operation accepts snapshot/run identity and job controls, never an inventory
DTO. It keyset-pages packages and types by `(qualified_name,id)`, relationships by
`id`, documents by `id` and character range, checkpoints by `stage_sequence`, and
classes by `id`. Page size is capped at 512 rows and defaults to 128. Package ancestry
for coupling is resolved only for the current relationship page.

Every inventory/document slice is summarized independently and transactionally
checkpointed. Summary rows are reduced in fixed fan-in groups (default 8, maximum
16) until one bounded brief remains. Class purposes are requested in token/output-
aware batches capped at 16. Exact requested ID coverage, uniqueness, membership,
and purpose length are validated before each batch is staged in
`architecture_class_purposes`. Later phases page those rows; no repository-sized
purpose map exists. Only a final transaction creates a READY synthesis and copies
the complete staged set into `class_pre_explanations`.

Checkpoint/run identity includes snapshot facts, document revisions, provider/model,
prompt and pipeline versions, model budgets, body caps, and relevant working-set
settings. Planning and ordering are deterministic, so restart replays the plan and
reuses validated rows. A failed bounded request gets at most three attempts with
capped backoff. Size failures split only the current slice/batch. Cancellation is
checked between requests and within the checkpoint/publication transaction. Staged
partial coverage remains non-READY.

Explain all uses SQLite as the queue, not a Java producer queue. `total_items=-1`
means architecture is ready but queue pagination is incomplete; zero is a valid
fully populated empty queue. Eligible CLASS/METHOD IDs are keyset-paged and inserted
with `INSERT … SELECT`. Relation count, declaration LOC, and stable ID are persisted
or computed with indexed SQL. The single worker claims a configured bounded page
and issues one model request at a time, ordered by priority and then
`relation_count ASC, loc ASC, subject_id ASC, id ASC`. Relationships remain explicit,
on-demand work. Startup resets abandoned `IN_PROGRESS` rows and incomplete queue
population resumes idempotently.

`ContextBuilder` is shared by bulk, explicit symbol/method, and relationship paths.
It applies hard limits to related symbols/methods, relationship/call-site evidence,
source characters, prior explanation characters, project documents, and global
inventory rows. SQL selects and `substr` avoid fetching discarded TEXT. Evidence is
ordered deterministically and fetched lazily until the prompt budget is spent. Edge
contexts keep endpoint and call-site evidence within the same documented occurrence
cap. A `context-limits` evidence block records truncation/omission; omission never
means absence.

`ModelClientService` serializes each request once, rejects it at an independent byte
cap, and reads the HTTP response stream only through `maxResponseBytes + 1`. It keeps
one bounded response for validation, rejects oversize/truncated bodies recoverably,
and never logs prompts, source, response bodies, keys, or credentials. The local
semaphore fixes maximum in-flight provider calls at one for the bottom-up policy.

The queue status DTO is version 2 and contains aggregate counts plus only the latest
job's current state. React uses one shared recursive polling primitive that schedules
only after the previous promise settles. Polling stops on terminal/inactive state,
workspace change, or unmount, and ignores late results after cleanup.

## Persistence and lifecycle

V006 adds checkpoint plan fields, durable staged class purposes, and primary queue /
context indexes. V007 introduces snapshot-bound generated-work cleanup. V008 adds
keyset and status lookup indexes. V009 replaces the cleanup trigger with the complete
foreign-key dependency order so explicit snapshot deletion also removes graph facts,
jobs, checkpoints, and generated outputs while retaining workspace logical symbols,
notes, and bookmarks. Document revision invalidation deletes only unfinished,
unreferenced runs; artifacts referenced by a published/stale synthesis are retained
as provenance. Successful explanations are marked stale rather than deleted.

## Consequences

Java memory is proportional to configured page, batch, context, response, and
concurrency limits. SQLite storage and total provider calls still grow with repository
size. Hierarchical summaries are lossy generated interpretations, not graph facts,
and need live-model quality review. Sequential requests favor determinism, evidence
availability, and predictable memory over maximum throughput. The byte/token estimate
is deliberately conservative; the provider's finite context enforcement remains
authoritative.
