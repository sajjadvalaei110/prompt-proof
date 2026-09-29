# ADR 0008: Multi-Language Support (Go, Dart/Flutter) and Retirement of the Java-Only Mission

- **Status**: Proposed
- **Date**: 2026-09-22

## Context

Code Atlas was built, and is currently documented (`AGENTS.md`, `docs/BUILD.md`, ADR 0001), as a
Java/Spring/Gradle-only tool. Two existing decisions directly block adding other languages:

1. `docs/BUILD.md` (frozen product brief) states: *"Defer embeddings until lexical symbol search,
   graph neighborhoods and scoped retrieval demonstrate a concrete gap. Defer Neo4j, cloud sync,
   multi-user permissions, arbitrary language support, autonomous refactoring and code editing until
   the comprehension workflow is reliable."*
2. ADR 0001 selected JavaParser over Tree-sitter specifically because "Tree-sitter... lacks an
   integrated Java symbol solver for method overload and type resolution" — a Java-specific
   justification that does not generalize.

The product owner now wants Code Atlas to stop treating Java as the sole first-class language, add
Go support, then add Dart support (with particular emphasis on Flutter). This ADR records that
decision, the scope it does and does not cover, and the specific existing invariants it revises.
`docs/BUILD.md` itself is left unedited (per `CLAUDE.md`, it is frozen history); this ADR is the
recorded deviation.

## Decision

### 1. Mission scope: open-ended multi-language, not a fixed three-language list

Code Atlas's mission changes from "a Java/Spring code-understanding tool" to "a local,
privacy-first, multi-language code-understanding tool." Go and Dart/Flutter are the first two
languages added under this mission, not its final scope — later languages follow the same seam
without requiring another core refactor. `AGENTS.md`'s mission statement is updated accordingly
(see "Follow-up documentation changes" below).

### 2. Sequencing: core refactor, then Go, then Dart

Work proceeds in three ordered phases, each independently shippable and verifiable:

1. **Language-agnostic core refactor.** Extract a language-neutral analysis port — the symbol,
   relationship, evidence, and resolution-status model — with the existing Java/JavaParser
   implementation as its only adapter. No behavior change for Java; this phase is a pure
   extraction, verified by the existing Java test suite passing unchanged.
2. **Go**, added as a second adapter behind that port.
3. **Dart/Flutter**, added as a third adapter behind that port.

This mirrors how `SpringAnnotationAnalyzer` was added as a heuristic layer on top of core Java
parsing, rather than baked into it from the start.

### 3. Workspace language model: single language per workspace, user-selected

A workspace analyzes exactly one language. The user selects the language explicitly in the import
start menu; there is no mixed-language graph and no auto-detection fallback in this phase. The
language picker lists only languages whose analyzer has actually shipped — it never offers a
"coming soon" option that would error or silently no-op if selected.

### 4. Go analysis: structural first, real toolchain, network disabled

Go v1 covers structural facts only — packages, functions/methods, structs, interfaces, imports,
and the call graph — the Go analog of what JavaParser gives for plain Java today. Framework-aware
heuristics (e.g. Gin/Echo routing, wire/fx-style DI, analogous to `SpringAnnotationAnalyzer`) are
explicitly deferred to a later milestone, not part of this ADR's scope.

Go analysis uses the real `go/packages` and `go/types` tooling (not a hand-rolled parser or
Tree-sitter grammar) for accurate type and symbol resolution, but invokes it with network access
forced off (`GOPROXY=off`, `GOFLAGS=-mod=mod` or equivalent — exact flags to be confirmed during
implementation) so indexing cannot reach the network and stays consistent with "no hidden cloud
egress." If a workspace's Go module cache is incomplete for what's forced offline, affected
relationships resolve as `candidate`/`unresolved` rather than failing the whole import.

If the Go SDK/toolchain is not present on the host machine, importing a Go workspace is **blocked**
with a clear setup error (install Go, re-import) — it does not silently degrade to a weaker parse.

### 5. Dart/Flutter analysis: structural first, real SDK analyzer, blocked without it

Dart v1 covers structural facts only — classes, mixins, extensions, functions, imports — the Dart
analog of plain Java parsing. Flutter's "magic" (widget composition, `build()` graphs,
`StatefulWidget` lifecycle, provider/bloc-style DI) is explicitly deferred to a later milestone,
even though Flutter was the specific motivation for adding Dart at all.

Dart analysis invokes the local Dart SDK's analyzer, read-only, rather than a hand-rolled or
Tree-sitter-based Dart parser, for stronger type resolution. As with Go, if the Dart SDK is not
present on the host, import is **blocked** with a setup error rather than degrading.

### 6. Schema: `language` column added in the core refactor phase

Phase 1 (core refactor) includes a Flyway migration (`V012__language_support.sql` or next
available number) that adds a required `language` column to the workspace/snapshot tables,
backfilling all existing rows as `'java'`. The column is not deferred to the Go milestone — the
schema is never in an ambiguous language-less state at any point after the refactor lands.

## Consequences

### Invariant revisions (must be reflected in `AGENTS.md`)

`AGENTS.md` currently states two invariants that this ADR narrows:

- *"Source-only import never evaluates Gradle, processors or target application code."*
- *"Never execute target code."* (Completion checklist wording.)

These were written with Java/Gradle in mind: don't run the target repository's own build, don't run
its annotation processors, don't execute its application code. Invoking `go/packages`/`go/types`
and the Dart SDK's analyzer is **not** running the target repository's build or application logic —
it is a first-party language toolchain reading source text read-only, conceptually adjacent to
JavaParser itself, not to Gradle. But it is a materially different posture from "process source
text ourselves, no external tool invocation," which is what the current wording implies for Java.

`AGENTS.md`'s invariant is reworded (not silently reinterpreted) to:

> Source-only import never runs the target repository's own build system, build plugins, annotation
> processors, or application code. Read-only invocation of a language's own first-party analysis
> toolchain (e.g. `go/packages`/`go/types`, the Dart SDK analyzer) for symbol/type resolution is
> permitted, provided it cannot reach the network and never executes target application logic.

- **Trade-off**: this is a narrower, more permissive boundary than before. It should not be read as
  license to invoke arbitrary target-repository tooling (e.g. still no running the target's own
  `go generate`, build scripts, or Flutter build_runner) — only the language's own read-only
  analysis frontend.

### Java behavior is unchanged

Phase 1 is a pure extraction; JavaParser remains Java's adapter behind the new port. Existing Java
snapshots, evidence, and explanations are unaffected. The full existing Java test suite (backend
+ frontend pure-logic tests + browser acceptance pipelines) must pass unchanged after Phase 1
before Go work starts.

### Evidence and trust-split model generalizes unchanged

The `resolved`/`candidate`/`unresolved` relationship-status model and the `source_fact` /
`inferred_purpose` / `unknown` explanation-claim-basis model apply identically across languages —
this ADR does not introduce a language-specific trust tier. Weaker resolution (e.g. Go relationships
that can't be resolved because network-disabled module fetch left a dependency unavailable) is
expressed as `candidate`/`unresolved`, the same vocabulary Java already uses for ambiguous overloads
or unresolved imports.

### Follow-up documentation changes (tracked, not part of this ADR's text)

- `AGENTS.md` mission statement: "Build a local Java/Spring/Gradle code-understanding application"
  → "Build a local, multi-language code-understanding application," with the reworded invariant
  above.
- `docs/ARCHITECTURE.md` module table: `analysis` row gains a note that language-specific adapters
  (Java/JavaParser, Go, Dart) sit behind a shared port, same pattern as the existing note that
  `SpringAnnotationAnalyzer` lives inside `analysis`, not a separate top-level package.
- `PROJECT_STATUS.md`: new entries recording each phase's verified state as it lands, per existing
  convention (exact commands run, pass/fail, anything explicitly not run and why).

## Alternatives Considered

- **Tree-sitter grammars for Go/Dart instead of native toolchains**: rejected for v1 because it
  would give weaker type resolution than `go/types`/the Dart analyzer for no offline-purity benefit,
  since both chosen tools can be run fully offline anyway (network forced off for Go; the Dart
  analyzer performs no network I/O for local analysis). Tree-sitter remains a reasonable fallback if
  a future language lacks a viable offline-capable native toolchain.
- **Mixed-language workspaces**: rejected for this phase — threading a language tag through
  workspace/graph/evidence/UI simultaneously with adding two new analyzers is a larger simultaneous
  change than the single-language-per-workspace model, which still supports the stated Go and Dart
  use cases (a Go backend and a Flutter frontend can be imported as two workspaces).
  Revisit once Go and Dart are both stable single-language workspaces.
- **Degrading to weaker parsing when Go/Dart SDK is missing** (instead of blocking import): rejected
  because it risks silently shipping graphs with much weaker resolution than the user would
  reasonably expect, and masks a fixable setup problem (install the SDK) behind a confusing "why is
  everything unresolved" experience. Revisit if in practice many users hit this without an easy
  path to installing the SDK.
- **Framework magic (Gin/Echo, Flutter widgets) in the same milestone as structural parsing**:
  rejected to keep each milestone bounded and independently testable, following the precedent set
  by `SpringAnnotationAnalyzer` shipping after core Java parsing, not alongside it.
