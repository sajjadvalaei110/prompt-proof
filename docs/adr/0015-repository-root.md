# ADR 0015: An optional repository root for module workspaces

- Status: Accepted
- Date: 2026-10-01
- Scope: `workspace` (validation, lifecycle), `storage` (V014), `analysis.port` (`locateBuildRoot`,
  `prepareWorkspace`), `review` (Git root, module scoping), import screen

## Context

A workspace path may be a module or a subdirectory of a repository. Two things then have to be found above it:

| Root | How it was found | Limitation |
|---|---|---|
| Build root (scip-java, ADR 0012 §3) | `ScipJavaTool.locate` walked up to the nearest `settings.gradle(.kts)`, else `build.gradle(.kts)`, never past the first `.git`. | No way to name the root. |
| Git root (ADR 0006) | `git rev-parse --show-toplevel`. | `ReviewService` rejected any workspace that was not the Git top level, so a module could not be reviewed at all. Every Git command also ran with `GIT_CEILING_DIRECTORIES` at the workspace's parent, so Git could not find a parent repository on its own. |

The owner asked for one optional field naming the directory that holds the build and the Git repository, used
instead of relying on auto-detection. They settled D4–D6 before implementation. A grilling round then settled Q2
(what a module's review covers) and Q3 (a module without a root).

## Decision

### 1. One field, validated in `workspace` (D4)

- `WorkspaceRequest.repositoryRoot` has three states:
  - absent: keep the stored root;
  - blank: clear it (auto-detect);
  - a path: set it.
- `RepositoryRootValidator` (package `workspace`) normalizes the path the way the workspace path is normalized
  (quotes, `~`, relative paths), checks it exists and is a directory, and canonicalizes it (`toRealPath`).
- The canonical root must contain the canonical workspace. Equal is allowed.
- A missing path, a file, a root that does not contain the workspace, or a link resolving somewhere that does not
  hold the workspace (a symlink escape) is a 400. Nothing is written.
- `WorkspaceResponse.repositoryRoot` reports the stored canonical root.

### 2. Build root through the port (D5)

- `AnalysisPort.locateBuildRoot(workspace, boundary): Optional<Path>` defaults to empty, since an engine that does
  not build has no build root.
- `AnalysisPort.prepareWorkspace(path, repositoryRoot)` defaults to `prepare(path)`. It has its own name so that it
  is not confused with `prepare(captured, workspaceRoot)`, the review-capture variant.
- scip-java implements both through `ScipJavaTool.find/locate(workspace, boundary)`:
  - the boundary is the repository root, or the nearest `.git` when no root is set (the previous walk);
  - the walk checks the boundary itself and never goes above it;
  - Gradle marker names stay inside the Java adapter.
- `WorkspaceService` calls `locateBuildRoot` at registration for an engine with `executesTargetBuild()`. "No build
  marker under this root" is a 400 before anything is saved.
- `AnalysisService` passes the stored root to `prepareWorkspace`.
- Go and Dart markers (`go.work`/`go.mod`, `pubspec.yaml`/`melos.yaml`) will arrive with their engines.

### 3. Git root and what a module's review covers (D4, Q2, Q3)

- **With a root set**, review uses it as the Git root. It must be the top of a Git work tree (`rev-parse
  --show-toplevel` equals it). Otherwise review is unavailable with "the repository root … is not the top of a Git
  work tree …" (400) and no review snapshot is created.
- **With no root set**, the Git root is found from the workspace: the nearest directory at or above it with a `.git`
  entry, confirmed by Git as its own top level. Git is never asked to search upwards on its own; every call keeps the
  ceiling at the queried directory's parent. A module workspace is now reviewable without a root (Q3). The old "must
  be the Git worktree root" rejection is gone.
- **What is compared.** Git always runs at the Git root. Only paths under the workspace's module path are captured
  and compared (Q2):
  - base tree, working tree and diff are filtered by the module prefix and keyed relative to the workspace, the same
    base as the workspace's ordinary snapshots;
  - build-output exclusions apply to both the full and the module-relative path, so a module's `build/` stays out;
  - changed files outside the workspace are counted in one diagnostic, `CHANGES_OUTSIDE_WORKSPACE` ("N changed files
    outside this workspace (<module>) are not compared.");
  - the capture fingerprint stays repository-wide;
  - the data directory must be outside the Git root.

### 4. Lifecycle like the engine choice (D6)

- **Storage.** V014 adds nullable `workspaces.repository_root` and `snapshots.repository_root`, with no default and
  no backfill. Existing rows keep auto-detection, which is the old behavior.
- **Provenance.** Every analysis and review snapshot records the root configured when it was produced.
- **The import form** always sends the field: empty means auto-detect, so the form replaces whatever was stored. It
  is prefilled from the loaded workspace.
- **Re-analyze source and Recent projects** omit the field and keep the stored root, as they do for `indexer`
  (`workspaceRequestBody` in `importEngine.ts`, tested).
- **No automatic analysis.** Changing the root does not start one; the next analysis or Recompare uses it.
- **Recent projects** shows the root read-only. It is edited through the import form.

## Consequences

- **Module workspaces.** They can be reviewed, from an explicit or detected root, and a scip-java module can bound its
  build search explicitly.
- **Earlier failure for build engines.** A build engine's registration fails at once when no build marker is under
  the boundary. Before, the first analysis job failed. Tests that registered an empty directory with scip-java now
  give it a `settings.gradle`.
- **Unchanged guarantees.** Review never builds, never checks out and never writes to the repository; the AGENTS.md
  invariants are unchanged.
- **Language-neutral.** The root fields and the port carry no Java names. `AnalysisServiceDispatchTest` proves the
  root reaches a non-Java fake engine and is recorded on its snapshot.
- **Limits:**
  - the root must be the Git top level itself, not any directory inside a repository;
  - review still captures Java files only (`GitReviewSourceAdapter.javaPath`, a known gap since ADR 0008).

## Alternatives considered

- **Separate Git root and build root fields.** Rejected (D4): one directory holds both in every layout the owner
  named, and two fields invite contradictions.
- **Review the whole repository and map paths in navigation.** Rejected (Q2): the overlay would show files the map
  does not cover, and every consumer would need a path mapping.
- **Keep rejecting module workspaces unless a root is set.** Rejected (Q3): auto-detection exists exactly so that the
  common layout needs no configuration.
