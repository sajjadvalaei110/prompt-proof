# ADR 0016: Quick intent popup, a plain prompt, faithful import and design-only projects

- Status: Accepted
- Date: 2026-10-02
- Amends:
  - ADR 0015 §2 (what follows a create), §3 (default relation kind), §5 (the Prompt);
  - ADR 0014 §5 (import of parsed context) and §1 (relation origin).
- Scope:
  - frontend: `DesignQuickPopup`, `designModel` (`defaultRelationKind`, `isImported`, `isDesignedRelation`),
    `graphModel.aggregateEdges`, `nodeCard`, `GraphCanvas`, `ImportScreen`, `App`;
  - backend: `design.DesignPromptService` (rewritten), `DesignService` / `DesignExchangeService` (relation
    origin), `WorkspaceService` / `WorkspaceController` / `JobService` (design-only projects), V015.

## Context

The owner's feedback on ADR 0015:

1. A relation drawn with two clicks should simply be a **call**. Inferring USES_TYPE, IMPLEMENTS or
   DEPENDS_ON from the endpoints was surprising.
2. After creating a resource or a relation, the full popover (title, Details, "More…", key) felt like a
   dialog. They asked for a small thing at the relation's middle (or next to the new card): the intent,
   ready to type in, then the kind. No details: double-click is the way to edit precisely.
3. The Prompt must be human-readable and much simpler, and the agent receiving it must learn nothing about
   Code Atlas. It should read like "add a class here for this intention; this class calls that class for
   this intention".
4. Import and Export belong at the bottom right of the map, under Fit map and Full screen, at the right end
   of the legend. Prompt stays at the top.
5. Importing an exported view must show exactly what was there, even with no code.
6. The first page needs an Import option.

Decisions (2026-10-02, AskUserQuestion; every recommendation accepted):

- First-page Import creates a **design-only project**.
- Imported code the project lacks looks **like the original**.
- The Prompt **leaves out implemented items**.
- **Prompt stays at the top**.

## Decision

### 1. Two clicks make a CALLS relation

`defaultRelationKind` always returns `CALLS`. The quick popup changes it.

### 2. The quick intent popup

`DesignQuickPopup` opens right after:

- a two-click relation, **centred on the relation's middle** (halfway between the two cards' rendered
  centres);
- an inline create of a package, class or method (Enter on the draft), just right of the new card's top
  corner.

It is a single row:

- the intent input, focused;
- the kind select: relation kinds for a relation, the type kinds for a class. There is none for a package
  (one kind) or a method (a constructor must be named after its class);
- a save button.

Its behaviour:

- Enter saves, in one change set: `putRelation` (delete + put when the kind changed), or `updateResource`
  with `kind` and/or `explanation`.
- Esc closes without saving. The item stays: it was created on the first step.
- A click elsewhere saves what was typed.
- An empty popup with an unchanged kind saves nothing.

Double-click keeps the full `DesignPopover` (intent, details, kind, "More…") for precise editing.

### 3. The Prompt is a plain request

`DesignPromptService` is rewritten. The output is Markdown with three numbered sections:

- **Add**: PLANNED authored resources, parents first. For example: "Add an interface `AuditLog` in
  package `com.example.audit`. Purpose: …", "Add a method `findByCustomer(Long)` to class `OrderService`
  (package …)". The signature is used when one was written.
- **Change**: intentions written on existing code, which are requested behaviour changes.
  - For a resource: "Change class `OrderService`, in package …. What should change: …".
  - For a relation the code has (origin CODE, §4): "Change how class `X` calls class `Y`. What should
    change: …".
- **Connect**: designed relations the code does not have yet, with a verb per kind. For example:
  "Class `AuditQuery` (new) should call interface `AuditLog` (new). Reason: …".

Detail paragraphs follow each item, indented. Names are human:

- a type by its simple name, or by its qualified name if two types share it;
- a member as `Type.name(Types)`;
- a package by its full name.

It never mentions the tool, keys, statuses, the API or a report-back step: `AgentGuide.reportBack` is
removed. It leaves out:

- implemented resources and relations;
- orphaned items;
- imported code with no intention.

The endpoint (`GET /api/workspaces/{id}/design/prompt`) and the Prompt dialog are unchanged, apart from
the dialog's description.

### 4. Relation origin: designed vs carried code (V015)

`design_relations.origin` is `AUTHORED` (default) or `CODE`. A CODE relation is a parsed dependency carried
along, never design work. It arises in two ways:

- **Explaining a relation the code has**: `putRelation` stores CODE when the parser already has that
  relation between those endpoints. Status is PRESENT, or MISSING once the code drops it.
- **Importing a parsed dependency** (brief `layer: CODE`). It is stored as CODE and re-exported as
  `layer: CODE`.

The overlay reports CODE relations with resolution `CODE`. On the map, `mergeDesignGraph` makes them
ordinary routes: `aggregateEdges` merges them with the parser route between the same cards, and they are
grey, not violet. The resolution rank treats `CODE` as settled, so it never worsens a route. Only an
AUTHORED relation gets its own dashed violet route (`isDesignedRelation`).

### 5. Imported code looks like the original

A CODE-origin resource absent from this code (an imported reference, status MISSING) is drawn as an
ordinary card:

- no violet border and no NOT IN CODE badge;
- the subtitle ends with "· imported";
- no source button: the canvas element data carries `noSource`, because Cytoscape data holds no
  `design` record. This also fixes a round-2 bug where planned cards showed a `</>` button.

Planned cards keep their PLANNED badge and violet style.

### 6. Design-only projects and first-page Import

`POST /api/workspaces/design-only {name}` creates a workspace with:

- `canonical_root = design-only:<id>`;
- `trust_state = design_only`;
- an empty published snapshot set active.

So every snapshot-keyed read (graph, design overlay, export, prompt) works unchanged on an empty parsed
graph. `WorkspaceResponse` gains `designOnly` and `name`. Analysis of such a project is rejected with a 400
("no source folder").

The first page offers **Import an exported map**. It:

- checks the file has a `codeatlas-design` block;
- names the project after the brief's workspace;
- creates the design-only project and imports the brief into it;
- opens it with the brief's layout as the **first tab**: `RESET` now takes an optional scope and kind.

Every card comes back at the same position and size (pinned by the browser pipeline and
`test-design-exchange.mjs`).

In a design-only project:

- Design is always on;
- Changes is disabled (there is no git);
- "Re-analyze source" is replaced by "Design only · no source folder";
- the recent-projects list shows the project's name.

Importing inside an open project turns Design on if it was off.

### 7. Import and Export placement

Export and Import sit at the right end of the legend row, directly under the map's zoom, Fit map and Full
screen controls. Design and Prompt stay at the top.

## Alternatives considered

- **Keep endpoint-inferred relation kinds.** Rejected by the owner: a call is what they usually mean.
- **Reuse the full popover after a create.** Rejected by the owner as dialog-like.
- **A read-only viewer for imported maps.** Rejected in favour of an editable design-only project.
- **Keep imported code as "NOT IN CODE" design cards and relations.** Rejected: the view must look like
  the original, and imported dependencies must never become prompt work.
- **A design-only workspace with no snapshot.** Rejected: an empty published snapshot keeps every
  snapshot-keyed path unchanged.

## Consequences

- AGENTS.md invariants hold:
  - CODE relations and imported resources are stored in the design layer, never as parser facts;
  - the resolution `CODE` names where they came from;
  - analysis never writes them.
- An explained parsed relation created before V015 keeps origin AUTHORED and stays IMPLEMENTED. Its
  intention then no longer reaches the Prompt (implemented items are left out). Explaining it again does
  not change the origin of an existing row.
- The Prompt is always the whole workspace.
- A design-only project cannot be turned into an analyzed one. Importing its export into a real project
  does that.
