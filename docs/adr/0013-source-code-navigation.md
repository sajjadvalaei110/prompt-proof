# ADR 0013: Source-viewer navigation and its language-neutral capability rule

- Status: Accepted
- Date: 2026-10-01
- Scope: `graph` (`NavigationService`), `analysis.port` (capability), `api` (`SourceController`,
  `GET /api/indexers`), `frontend/src/features/source/`

## Context

ADR 0012 shipped the data for IDE-like traversal: scip-java fills `code_occurrences` (V013) with every resolved
name, and `GET /files/definition` answers go to definition. The read-only source viewer
(`SourceDialog.tsx`) still rendered plain lines. The product owner asked for:

1. Ctrl/Cmd+click on the exact name a relationship refers to, jumping to the declaration at the other end, even
   in another file;
2. go to definition for every resolved name (types, methods, fields, parameters, locals), within and across
   files;
3. find in file with "N of M", Enter / Shift+Enter, match case and whole word, no regex.

Code Atlas is becoming multi-language (ADR 0008), and Go/Dart engines are planned. Navigation must therefore
belong to an indexing engine, not to Java: a future engine should light it up by filling `code_occurrences`,
with no viewer or endpoint change. The open decisions were settled with the owner in a grilling session
(2026-10-01).

## Decision

### 1. Capability rule: the engine declares it; data, never names, decides

- `AnalysisPort.providesNavigation()` (default `false`) declares that an engine fills `code_occurrences` under
  the contract below. `ScipJavaAnalysisAdapter` returns `true`; `JavaAnalysisAdapter` keeps the default.
  `GET /api/indexers` reports it per engine.
- `NavigationService` reads the snapshot's recorded `(language, indexer)` and resolves it through
  `AnalysisPortRegistry.find`. The declared capability decides. Only when a snapshot outlives its engine (an
  engine removed or renamed later) is the capability inferred from whether occurrence rows exist. This choice
  avoids a migration. It also tells "this engine does not index" apart from "this engine indexed nothing".
- A `not_indexed` answer carries `indexer`, `indexerLabel` and `navigationIndexers` (labels of the language's
  engines that do provide navigation). The viewer's hint is built from those fields alone ("This snapshot's
  indexer (<label>) doesn't provide go to definition; engines that do: <list>"). It is correct for review
  snapshots too, which always use the default engine. The frontend never branches on a language or engine id.

### 2. Occurrence contract (what an engine writes)

- Every resolved name in an indexed file, definitions (`is_definition = 1`) and references alike, locals and
  parameters included.
- Positions: 1-based lines, 1-based start column, **inclusive** end column, all columns in **UTF-16 code
  units**. That is what Java's `String` and JavaScript slice by, so the viewer slices lines without conversion.
  An engine whose tool reports UTF-8 bytes or code points (for example a scip-go or scip-typescript index
  declaring another `position_encoding`) converts before writing.
- `symbol` is an engine-scoped key the API never parses or exposes. Symbols local to a file must be unique per
  file (scip-java prefixes them with the file id). `display_name` and `signature` are set on definitions;
  `symbol_version_id` is set when the name is a graph symbol.
- An occurrence is navigation data only. It never creates or changes graph topology.

### 3. Endpoints (language-neutral)

- `GET /api/snapshots/{id}/files/occurrences?path=` returns `status` (`indexed` / `not_indexed` / `no_file`),
  the capability fields, a per-file symbol table `symbols: [{definitions, displayName}]`
  (`definitions = 0` means resolved outside the workspace) and compact rows
  `[line, startColumn, endLine, endColumn, symbolIndex, isDefinition]` ordered by position. At most **50,000**
  rows per file; `truncated` and `total` say when more exist, and the viewer tells the user that go to
  definition covers only the first rows.
- `GET /api/snapshots/{id}/files/definition` keeps its statuses (`found` / `external` / `no_symbol` /
  `not_indexed`) and gains the capability fields. The innermost (shortest) occurrence at a position wins; the
  viewer's tokenizer applies the same rule.
- Neither the service nor the DTOs contain Java names, symbol grammars or file extensions.
  `analysis/scip/ScipIndex` and `ScipSymbol` were not touched.

### 4. Viewer behavior

- **Find in file** (`findInFile.ts`): pure text over exactly what is rendered, which is the plain lines or the
  current diff layout's rows, so it works for every snapshot, language and mode. The query is always a literal.
  "Whole word" uses Unicode boundaries (`\p{L}\p{M}\p{N}\p{Pc}`), not any language's identifier rules. Matching
  stops at **10,000** matches ("10,000+").
- **Tokens** (`codeTokens.ts`): a span is clickable only because an occurrence row covers it, never because it
  looks like an identifier. A line with no occurrence or match stays one text node. There is no virtualization:
  only lines with ranges are split. Spans hold text only; source is never rendered as HTML. Stale rows are
  clamped to the shown text, and cuts never split a surrogate pair.
- **Go to definition**: occurrences are fetched once per file, after the first sign of navigation intent
  (Ctrl/Cmd pressed, or a jump), with at most 4 requests in flight. With Ctrl/Cmd held, the token under the
  pointer underlines. A click asks `/files/definition` (one request per click, never per hover):
  - one location opens that file in the dialog, scrolled to the definition with its token outlined;
  - several locations open a small picker listing `path:line`;
  - `external` shows "<name> · outside workspace" as a tooltip and a message, and does not navigate;
  - `not_indexed` shows the hint from §1.

  Nothing is fetched from the network.
- **Back/forward** (`navigationStack.ts`): header buttons and Alt+←/→. The history is dialog-local and bounded
  (100 entries), and each entry remembers its scroll offset. Like selection (ADR 0009), it is never part of a
  tab's undo history. It resets when the dialog's subject changes or the dialog closes.
- **No graph side effects**: a jump does not select or reveal anything on the map.
- **Changes diff**: find works there. Go to definition is off in diff sections in v1, and the dialog says so.
  (2026-10-01: shipped in [ADR 0014](0014-diff-navigation-source.md). The head side is served from the workspace's
  active snapshot where the file is unchanged since, and deleted lines say they are not navigable.)

## Consequences

- A future Go, Dart or TypeScript engine gets find in file at once. It gets go to definition by declaring
  `providesNavigation()` and writing rows under §2. `NavigationServiceTest` proves this with a fake non-Java
  "fixture" language through the real `AnalysisService` and the HTTP endpoints. `scripts/test-code-tokens.mjs`
  proves it for the viewer's tokenizer, using Go- and Dart-shaped files.
- No Java-specific shortcut was needed. The only Java-specific facts stay in `ScipJavaAnalysisAdapter` (how it
  keys locals and reads javac positions).
- Known limits:
  - navigation needs a modifier key, so touch devices get find but not go to definition;
  - files past 50,000 occurrences are only partly navigable;
  - very large files render every line (no virtualization);
  - a definition in a file that is not stored in the snapshot (for example a sibling module outside a module
    workspace) reports `external`.

## Follow-ups (deliberately not in this milestone)

- **Find references**: the reverse lookup. The table and its `(snapshot_id, symbol, is_definition)` index
  already support it; it needs a results UI.
- **Show on map**: selecting or revealing a jump target that is a graph symbol (`symbolId` is returned). It
  would go through ADR 0009's selection-only path and needs reveal logic for hidden cards.
- ~~Go to definition inside the Changes diff~~ (ADR 0014), and a touch gesture for navigation.

## Alternatives considered

- **A snapshot column for the capability**: rejected. It duplicates what the engine declares, and it needs a
  migration.
- **Inferring the capability from occurrence rows only** (the previous behavior): rejected as the primary rule.
  It cannot tell a non-indexing engine from an empty index, and it cannot name the engines that would help.
- **Tokenizing by syntax (identifier regexes, comment/string detection)**: rejected. It is language-specific,
  and it would make unresolved text look navigable.
- **One definition request per hover**: rejected in favor of one occurrences request per file. Hover state
  (clickable, external) comes from that payload.
