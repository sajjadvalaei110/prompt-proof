# ADR 0014: The engineer-owned design layer, agent change sets and the design brief

- Status: Accepted
- Date: 2026-10-01
- Scope: new `design` module (`DesignService`, `DesignExchangeService`, `DesignKeys`, `AgentGuide`),
  `api/DesignController`, V014, `explanations` (context block, prompt, citation rule),
  `frontend/src/features/design/`, `GraphCanvas`, `InspectorPanel`, `App`

## Context

Code Atlas only drew parser facts. The product owner asked for:

1. adding resources (packages, types, methods) and relations at every level to the map, and adding
   classes and methods inside resources that already exist;
2. explanations on resources and relations, written by the engineer or by AI agents, whose first
   sentences state the intent (one text, not a separate "intention" field);
3. AI agents working on the map through REST, with the engineer free to edit what they built;
4. export as a prompt an AI agent can read cold, which also imports back to rebuild the same map.

AGENTS.md said "Parser/rule facts own graph structure" and "Every relationship has evidence and an
explicit resolution status". Mixing authored nodes into parser facts would break both. The open
decisions were settled with the owner in a grilling session (2026-10-01).

## Decision

### 1. A separate, workspace-scoped design layer

- Authored items live in `design_resources` / `design_relations` (V014), never in `symbol_versions` /
  `relationship_occurrences`. Analysis never writes them, snapshot deletion never touches them, and
  model output never writes them.
- They are keyed by the parser's stable logical key (`logical_symbol_key` = qualified name; methods
  `Owner.name(ParamType,...)`), not by snapshot UUIDs, so they survive re-analysis. `DesignKeys` builds
  keys exactly as `JavaParserAdapter` does.
- `origin = AUTHORED` is a resource the engineer or an agent added. `origin = CODE` is an explanation
  attached to parsed code, or an imported reference to code.
- Status is computed on every read against a snapshot, never stored:
  - `PLANNED`: authored, not in the code yet.
  - `IMPLEMENTED`: authored, and the code now declares that key. For a relation: a parser relationship
    of the same kind exists between the endpoints or anything inside them.
  - `PRESENT`: parsed code that carries an explanation.
  - `MISSING`: a reference to code that is not in this codebase, e.g. after importing a brief elsewhere.
  - `ORPHANED`: its parent, or a relation endpoint, is gone.
  Nothing is deleted automatically.
- Design relations reuse `RelationshipKind`, may join any two resources at any level (parsed or
  authored), and carry resolution `DESIGNED`. The explanation is their provenance instead of parser
  evidence. On the map they are dashed violet routes, which `aggregateEdges` keeps apart from parser
  routes. Design-only cards are dashed violet with a PLANNED / NOT IN CODE / ORPHANED badge and have no
  source button.

### 2. Parsed code is not restructured

Parsed resources accept only an explanation. Renaming, moving or deleting them is rejected; an
intended change to existing code is written as free text in its explanation (owner decision: "change
intent can be any paragraph, not structured"). Authored resources can be renamed, moved and re-kinded
within their category, with designed children and relations following the new key.

### 3. One explanation text, intent first

Each item has one `explanation` (≤ 20,000 characters). By convention its first paragraph is the
intent; the UI emphasises it, and the map hover uses it. On parsed code the engineer's explanation is
primary in the inspector, and the model-generated explanation stays below it, labelled "Generated
explanation".

The local model receives the engineer's explanation of the subject as a context block
`design-<id>-r<rev>`, labelled an untrusted assertion and never parser fact. The prompt (v4.1) tells
the model to lead with the stated intent when the code is consistent with it and to say where the
code differs. As with `doc-` and `ai-` blocks, a `SOURCE_FACT` claim citing only `design-` blocks is
rejected. Changing an explanation marks that subject's READY generated explanation STALE.

### 4. AI agents use the same REST API, with no review step

`POST /api/workspaces/{id}/design/changes` applies an ordered change set atomically:
`putResource`, `updateResource`, `deleteResource`, `putRelation` and `deleteRelation`. `?dryRun=true`
validates and rolls back. Any invalid operation fails the whole set with a 400 naming the operation.

Each write records `author` (`created_by` / `updated_by`), shown only as a small provenance line.
There are no proposals, approvals or comments. The engineer drives the agent, and edits or deletes
afterwards (owner decision). The UI polls the layer every 4 s while visible, so agent changes appear
without a reload.

`GET /api/agent-guide` documents the contract. The API is loopback-only like the rest of the backend,
and there is no extra authentication. Limits: 5,000 resources, 10,000 relations, 1,000 operations
per set.

### 5. The design brief: Markdown plus a fenced JSON block, scoped by the map

`POST /api/workspaces/{id}/design/export` takes the active tab's scope and layout, keyed by stable
keys, and returns Markdown with these sections:

1. a reading contract: code facts vs design, intent first, statuses, keys;
2. a summary;
3. the module tree with every explanation quoted under its resource, plus READY model summaries
   labelled as generated;
4. designed relations, then parsed dependencies with counts and resolution;
5. the agent guide;
6. a ```` ```json codeatlas-design ```` block (schema v1) carrying resources, relations, layout and
   omissions. The fence grows beyond any backtick run in the content.

Parsed context is bounded: 4,000 resources and 8,000 aggregated relations, with omissions stated.
Source code is never exported.

`POST /design/import` parses only that block, upserts by key and never deletes. Parsed resources the
target code lacks become `CODE` placeholders (status MISSING), so the same map comes back in another
workspace. The returned layout opens in a new tab with geometry re-applied by key. Re-importing the
same brief changes nothing.

### 6. History and visibility

Design edits are server operations, like project documents. They are outside undo history, and
deletes ask for confirmation. When the merged graph changes, every tab's current journey is reconciled
in place (`RECONCILE_ALL`): new cards are admitted, deleted ones leave, and history entries are not
rewritten.

A **Design** toolbar toggle (a per-viewer preference in `localStorage`, on by default) hides the
layer. The Changes overlay never shows the design layer; combining them is deferred.

## Alternatives considered

- **Mix authored nodes into parser facts.** Rejected: it breaks the two-layer trust split the whole
  product rests on.
- **Agent proposals with an approval inbox.** Proposed in the grilling session and rejected by the
  owner: the engineer drives agents and edits the result.
- **Structured change intents (MODIFY/REMOVE/MOVE) on parsed code.** Rejected by the owner in favour
  of free text.
- **A per-tab, undoable Design toggle.** Not built. A per-tab toggle needs the parked-ID machinery of
  the Changes overlay for little benefit, so a global view preference was chosen instead.
- **Separate Markdown and JSON exports.** Rejected: one file that is both readable and importable is
  simpler to hand to an agent.
- **Per-item PUT/DELETE endpoints.** Not added. A one-operation change set covers them with one
  contract.

## Consequences

- AGENTS.md invariants are amended: parser facts own the *code* graph, and the design layer is
  separately stored, visibly distinct and never written by analysis or models.
- `ReviewService` and the Changes overlay are unchanged.
- An ORPHANED type has no package card to sit in, so it is not drawn. It still appears in the
  overlay API and the brief.
- Keys depend on how the indexer prints parameter types (JavaParser source text vs scip-java
  signatures), so a planned method may only become IMPLEMENTED under the engine whose key format
  matches.
- Explanations are plain text in the UI; Markdown in them is shown as typed, never rendered as
  markup.
