# ADR 0004: Bounded, resumable architecture preparation

- Status: Accepted
- Date: 2026-09-09
- Scope: R6 large-codebase Explain all
- Supersedes ADR 0003's single-request/oversized-input-failure policy only

## Problem

Requiring the complete inventory and every project document in one request makes
Explain all fail as projects grow. Increasing the input window alone does not
ensure the model can return every class within its output limit. Counting each
UTF-8 byte as a token also rejects ordinary Java/text inputs unnecessarily.

## Decision

Keep the configured context window and output allowance as finite per-request
limits. Settings no longer impose the unrelated 1,000,000-input/32,768-output
HTML maxima. These values describe the configured model's capabilities; zero does
not mean unlimited. No capability is inferred from a provider/model name. Saving
Settings validates the effective pair before mutating the profile, so the output
allowance cannot consume the whole context window.

`ModelRequestBudget` estimates ASCII at three characters/token and non-ASCII at
its UTF-8 byte bound. It reserves message framing, output and a 15% input margin.
This is a provider-neutral estimate, not an exact tokenizer. An explicit provider
context error remains authoritative. The adapter detects `finish_reason=length`
before attempting to parse potentially truncated JSON.

`ArchitectureBatchProcessor` owns preparation, budgeting, coverage validation and
checkpoint reuse behind a single `generate` operation. The queue owns scheduling,
cancellation and visible progress; the explanation service owns freshness and
atomic publication. No new provider, tokenizer, vector store or background
infrastructure is introduced.

Small projects retain a single request when estimated input and output fit. Larger
projects follow this pipeline:

1. Read the complete inventory, coupling and all documents in bounded slices.
   Preserve every character across slice boundaries, including document tails.
2. Summarize every slice, then reduce summaries until a compact global business
   brief fits. Every reduction round must shrink; non-compressing responses fail
   explicitly. Summaries are untrusted generated interpretations, never facts.
3. Request class purposes in deterministic inventory order, sized by output
   allowance and capped at 16 classes. This keeps checkpoints frequent even when
   the configured output limit is very large. Each request contains the brief,
   exact IDs/names/roles for its target
   classes and bounded direct incoming/outgoing relationship facts. Validate
   exact target coverage, unique known CLASS IDs and nonempty purposes.
4. Split class batches when the provider reports truncated output, rejects context,
   or omits requested classes. Split rejected context slices too. Reduce brief and
   neighbor allowance for a singleton context rejection. Stop with an actionable
   error when even a minimal request fails; never loop indefinitely or publish
   partial class coverage.
5. Publish all class drafts atomically, then release the existing degree/LOC/ID
   sequential CLASS/METHOD queue. Relationships remain on-demand.

Successful stages are checkpointed immediately in SQLite. The key covers the full
original architecture inputs, document revisions, model profile, pipeline version,
actual stage prompt and output allowance. Pipeline 2.1 also bounds a class batch at
16 targets, so an older all-at-once checkpoint cannot mask the new plan. Exact stage input/output, model/endpoint,
version and timestamp remain locally available for provenance. A retry or process
restart replays deterministic planning and reads matching checkpoints instead of
sending those requests again. Document/model/input changes select new keys.

Cancellation is checked between requests. An in-flight successful response can
be checkpointed, but cancellation prevents partial class publication or further
requests. Final publication rechecks document/model freshness. Existing successful
full explanations remain retained under the usual freshness rules.

Individual explanations use the same token estimate with reserved template/repair
space. They retain target source, prior class/method purposes and collaborator
context, explicitly identifying shortened/omitted evidence. Prompt 3.1 asks for
specific business rules, branches, side effects and collaborator responsibilities.

## Consequences and limits

The total project input and class output can exceed any one request's limits.
Total calls, latency and local checkpoint storage grow with project size; this is
not unlimited model context. Global summaries are necessarily lossy, can omit
business nuances and need real-model quality review. Exact target inventories and
static neighbors help ground each class batch, while original input and generated
stages remain retained. This release does not add semantic document retrieval or
claim to read every source file in every individual explanation.

Checkpoints are retained with the local application data; no automatic eviction
policy is introduced. Progress reports the current stage and completed checkpoint
count, not a misleading percentage whose denominator changes during splitting.
