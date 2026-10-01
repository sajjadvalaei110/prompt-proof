# ADR 0012: scip-java as a second, opt-in Java indexing engine

- Status: Accepted
- Date: 2026-09-29
- Scope: `analysis` (engine seam), `workspace` (engine choice and build consent), `storage` (V013),
  `graph` (go to definition), import screen

## Context

The product owner wants IDE-like code traversal: Ctrl+click from a relationship to the other end,
go to definition for every name in a file (locals, parameters, fields included) and across files.
The JavaParser engine cannot supply that honestly:

- its relationship evidence covers a whole expression (`orderRepository.save(order)`), not the name;
- it indexes no locals, parameters or fields, and has no reference index at all;
- its symbol solver sees only the workspace's sources and the JDK, so calls into libraries or
  generated code stay UNRESOLVED or are silently skipped.

Three indexers were considered. **SCIP via scip-java** (Sourcegraph, the de-facto standard format
for precise code navigation) was chosen by the owner. The other two:

- **Eclipse JDT Language Server.** Accurate, but a long-running external server that also imports
  (and runs) the Gradle build. It would need a second protocol client and lifecycle management for
  no accuracy gain over a one-shot compiler-backed index.
- **Tree-sitter.** Offline and fast, but syntax only: it cannot tell what a name refers to, which is
  exactly the missing fact.

scip-java produces its index by compiling the project with the SemanticDB javac plugin, through the
project's own build tool. That runs the target repository's build scripts, which the existing
invariant forbids for source-only import (`AGENTS.md`, ADR 0008 §Consequences). This ADR records the
narrowly scoped, opt-in exception.

## Decision

### 1. A language may ship several engines

`AnalysisPort` gains `indexer()` (a stable id), `defaultIndexer()`, `executesTargetBuild()` and
`unavailableReason()`. `AnalysisPortRegistry` keys ports by language *and* engine: `require(language)`
returns the language's default engine (unchanged behavior for every existing caller),
`require(language, indexer)` a named one, and `indexers()` describes every engine with its current
availability (`GET /api/indexers`). Java ships two engines:

| Engine id    | Adapter                     | Default | Runs target build |
|--------------|-----------------------------|---------|-------------------|
| `javaparser` | `JavaAnalysisAdapter`       | yes     | no                |
| `scip-java`  | `ScipJavaAnalysisAdapter`   | no      | yes (Gradle)      |

Future languages (Go, Dart, …) plug in the same way and may likewise ship a source-only default
plus a compiler-backed engine.

V013 adds `indexer` to `workspaces` and `snapshots` (backfilled `javaparser`); every snapshot records
the engine that produced it.

### 2. Running the build is explicit, recorded consent — never a default

- The JavaParser engine remains the default; a workspace registered without an engine is
  source-only, exactly as before.
- Choosing an engine with `executesTargetBuild()` requires `allowBuildExecution: true` in the
  registration request, or it is rejected with 400 before anything is written. Consent is stored
  as `workspaces.trust_state = 'build_allowed'` (the existing, until now unused, column).
  Choosing a source-only engine again resets it to `source_only`.
- `AnalysisService` re-checks the recorded trust before every run; a build engine on a
  `source_only` workspace fails the job without starting anything.
- The import screen offers the engine picker only when a language has more than one engine, shows
  an engine that is not installed as disabled with its setup instruction, and keeps Analyze
  disabled until the consent checkbox is ticked.
- **The submitted engine is always explicit.** The import form sends the engine its picker displays
  (the language's default from `GET /api/indexers` when nothing was chosen, or the built-in
  source-only default when that list could not be loaded) with `allowBuildExecution` from the
  checkbox, and an `autoPath` link sends the source-only default. So re-registering a path that an
  earlier registration gave scip-java switches it back to source-only, exactly as the form shows.
  Omitting the engine (keep the workspace's recorded engine and consent) is reserved for deliberate
  re-analysis: **Re-analyze source** and re-analysis from Recent projects.
- **Review captures never run a build.** Git review snapshots are always analyzed by the language's
  default (source-only) engine, whatever the workspace uses, so a comparison's two sides are
  analyzed alike. `ScipJavaAnalysisAdapter.prepare(captured, root)` refuses to run.

### 3. The repository stays read-only; downloads are minimized

- **Layout.** The workspace path may be a module or any directory inside a repository.
  `ScipJavaTool.locate` walks up from it to the nearest `settings.gradle(.kts)` (else the nearest
  `build.gradle(.kts)`), never past the enclosing Git root (found by walking up to `.git`).
  The whole build is compiled; only documents under the workspace path become graph facts, and
  symbols defined in sibling modules are treated like library symbols (no edge, occurrence only).
- **Build output stays out of logs.** A failed build throws `ScipBuildFailedException`, whose message
  names the build and the failure only; the tail of the build output (which can contain credentials
  or source text) is a separate field. `AnalysisService` logs the message alone and stores the tail
  as display data in the job's error message and the failed snapshot's diagnostics.
- **Private copy.** The build root is copied — regular files only, no symlinks, without `.git`,
  `.gradle`, `build`, `out`, `target`, `node_modules`, `.idea` — into
  `<data-dir>/indexer-work/scip-java-<uuid>/source`, and Gradle runs there. The copy is deleted
  afterwards (`codeatlas.indexers.scip-java.keep-work-directory` keeps it for debugging).
  The live test proves the fixture is byte-identical after a run.
- **No redundant downloads.** Gradle keeps using the machine's own Gradle user home, so the wrapper
  distribution and every cached dependency are reused. The default `dependency-mode` is
  `offline-first`: Gradle runs with `--offline`; only when that fails because a dependency is not
  in the cache does it run once more online, and a snapshot diagnostic says so. `offline` never goes
  online; `online` resolves normally.
- **The tool itself is not bundled** (≈120 MB of Scala/Kotlin tooling). `./gradlew installScipJava`
  resolves the pinned `com.sourcegraph:scip-java_2.13:0.12.3` through Code Atlas's own Gradle cache
  into `data/tools/scip-java/lib` (the default `codeatlas.indexers.scip-java.home`); a `scip-java`
  command on PATH also works. The install configuration is isolated from Spring Boot's BOM so
  scip-java runs with the dependency versions it was published with. The JVM running Code Atlas
  launches it.
- Gradle builds only for now (`--build-tool gradle`). scip-java also supports Maven and sbt; adding
  them is a detection change in `ScipJavaTool.locate`, not a new engine.

### 4. Graph facts keep the JavaParser engine's shapes

So that the explorer, the Spring pass, change detection, explanations and review all work
unchanged, `ScipJavaAnalysisAdapter` maps the SCIP index onto the existing tables with the same
vocabulary:

- **Symbols.** PACKAGE, CLASS/INTERFACE/ENUM/RECORD/ANNOTATION (from the declaration keyword),
  METHOD, and *explicit* CONSTRUCTOR, with JavaParser's qualified names
  (`pkg.Outer.Inner`, `pkg.Type.method(ParamType,…)`, `pkg.Type.Type(…)`, varargs as `T[]`),
  signatures (`String greet(String)`), return types and annotation names. Implicit constructors,
  fields, enum constants, locals and anonymous/local classes are not graph symbols. Symbol
  evidence is the declaration's full range (SCIP `enclosing_range`).
- **Identity.** scip-java names one declaration with different package fields depending on the
  referring module, so the descriptor text (`com/example/Greeter#greet().`) is the identity.
- **Relationships**, all `RESOLVED` because javac resolved them, each with evidence:
  EXTENDS/IMPLEMENTS for direct supertypes in the type header (javac's transitive supertypes are
  not edges); CALLS to in-workspace methods (overloads distinguished); CONSTRUCTS for `new T(..)`
  (the explicit constructor, else the type) and `T::new` (the type), never for `super(..)`/`this(..)`.
  The tokens around the name are read across lines, skipping whitespace, line and block comments,
  a qualifier (`pkg.Outer.`), constructor type arguments and type annotations, so `new` on one line
  and the type on the next is still a construction, while `renew Foo()` is not;
  USES_TYPE per (member, type) per file; DEPENDS_ON per (type, type) summarizing all of them, field
  accesses included; OVERRIDES from javac's overridden-symbol facts, subtype side only.
  Code outside members (field initializers) belongs to the type, and code in lambdas and
  anonymous classes to the enclosing member, as in the JavaParser engine.
- **Indexed text.** The index's ranges belong to the text the build compiled, so `ScipJavaTool`
  returns, with the index, the workspace's indexed `.java` sources read from the private copy after
  the build. The snapshot stores that text and builds every evidence snippet and the Spring pass
  from it; when the file on disk differs (edited during the build, or rewritten by a build task), a
  diagnostic says so. A file without indexed text keeps the disk content with a diagnostic and no facts.
- **Deliberate differences.** Relationship evidence is the exact name token javac resolved (its
  snippet is the source line), which is what Ctrl+click needs. Calls to the JDK, libraries or other
  modules produce no edge — they are resolved, just not in the workspace — instead of the
  JavaParser engine's UNRESOLVED CALLS rows. A file the build did not compile (outside every
  source set) is stored as source with a diagnostic and no facts. A build that fails to compile
  fails the analysis, showing the user (not the log) the tail of the build output: the engine does not degrade to guessing
  (the JavaParser engine remains available for such projects).
- **Spring.** The source-only Spring pass (`SpringFrameworkPass`, shared by both engines) runs
  after the scip-java passes and finds its symbols by the same names.

### 5. Occurrence index for navigation

V013 adds `code_occurrences`: every name the engine resolved in an indexed file — definitions and
references, including locals (keyed per file), parameters and fields — with 1-based coordinates in
the evidence convention, the graph symbol it names when there is one, and the declared name and
signature on definitions. It is navigation data only and never graph topology; the snapshot
deletion trigger removes it with its snapshot.

`GET /api/snapshots/{id}/files/definition?path=&line=&column=` answers go to definition:
`found` (with locations), `external` (resolved outside the workspace), `no_symbol`, or
`not_indexed` (the snapshot's engine records no occurrences, e.g. JavaParser). The source-viewer
Ctrl+click and find-in-file UI build on this and are a separate step.
(2026-10-01: shipped in [ADR 0013](0013-source-code-navigation.md). `not_indexed` is now decided by the engine's
declared `providesNavigation()`, with the rows as a fallback only for retired engines.)

## Consequences

- `AGENTS.md`'s source-only invariant gains its one exception, worded there: a build-running engine
  only with the owner's recorded consent, never for review captures, always in a private copy.
- scip-java facts are more precise than JavaParser's (javac resolution, libraries on the classpath),
  but depend on the project building on this machine with a compatible JDK.
- Tests: decoder, symbol grammar and signature parsing unit tests; a golden index produced by
  scip-java 0.12.3 from `test-fixtures/scip-gradle-project` drives an end-to-end
  `AnalysisService` test (graph shapes, evidence tokens, go to definition, module workspaces,
  consent, snapshot deletion); `ScipJavaLiveIndexingTest` runs the real tool and Gradle and is
  skipped when scip-java is not installed.

## Alternatives considered

- **Bundle scip-java as an application dependency** — rejected: ≈120 MB and a Scala/Kotlin
  classpath inside the Spring Boot jar for an optional engine.
- **Run Gradle in the repository itself** — rejected: it writes `build/`, `.gradle/` and
  SemanticDB output into a repository Code Atlas promises to treat as read-only.
- **A protobuf runtime and generated SCIP classes** — rejected: `ScipIndex` decodes the handful of
  fields needed directly from the wire format and skips the rest, without a code generator or a
  runtime dependency.
- **Replacing the JavaParser engine** — rejected: it needs no build, no JDK/toolchain match, works on
  code that does not compile, and remains the right default for untrusted repositories.
